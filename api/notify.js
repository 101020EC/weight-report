// api/notify.js — Vercel Serverless Function สำหรับส่ง Telegram แจ้งเตือนเมื่อกดสร้างรายงาน
// V33 (AUDIT-2026-11 WR-SEC-04): หน้าชั่งไม่มี login (เจ้าของตัดสินใจไว้) จึงกันด้วย Origin ต้องเป็นของเรา (ไม่มี Origin = ไม่รับ),
// ความยาวต่อช่อง และไม่เกิน 120 ข้อความต่อชั่วโมงต่อ IP (ทั้งทีมใช้ IP ที่ทำงานเดียวกัน)
const { originOk, ipTag, rateOk } = require('../lib/guard.js');
const NOTIFY_PER_HOUR = 120;
const cap = (v, n) => String(v == null ? '' : v).slice(0, n);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendTelegramNotification(message) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId   = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    console.warn(`[TELEGRAM NOTIFY WARNING] Missing env vars. BOT_TOKEN exists: ${!!botToken}, CHAT_ID exists: ${!!chatId}`);
    return { success: false, error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!resp.ok) {
      const errRes = await resp.text();
      console.warn(`[TELEGRAM HTML ERROR] HTTP ${resp.status}: ${errRes.slice(0, 200)} — Fallback to Plaintext...`);
      const plainText = message.replace(/<[^>]*>/g, '');
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText
        })
      });
    }

    if (!resp.ok) {
      const errRes = await resp.text();
      console.error(`[TELEGRAM API ERROR] HTTP ${resp.status}: ${errRes}`);
      return { success: false, error: errRes };
    }

    console.log('[TELEGRAM NOTIFY SUCCESS] Report creation notification sent to Telegram');
    return { success: true };
  } catch (err) {
    console.error('[TELEGRAM NOTIFY ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = async function handler(req, res) {
  const ok = originOk(req);
  if (ok) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!ok) return res.status(403).json({ success: false, error: 'Origin not allowed' });

  try {
    const { action, declaration_no, importer, date, goods_type, plates, diff_text } = req.body || {};
    if (action !== 'report_created') return res.status(400).json({ success: false, error: 'Unknown action' });
    if (!(await rateOk(req, 'notify', NOTIFY_PER_HOUR, 3600e3))) {
      console.warn(`[NOTIFY LIMIT] ip#${ipTag(req)}`);
      return res.status(429).json({ success: false, error: 'ส่งแจ้งเตือนถี่เกินไป' });
    }
    const tgMsg = `🖼️ <b>[สร้างรายงานชั่งน้ำหนักสำเร็จ]</b>\n` +
                  `• วันที่: ${escapeHtml(cap(date, 40) || '-')}\n` +
                  `• ผู้นำเข้า: ${escapeHtml(cap(importer, 80) || '-')}\n` +
                  `• เลขที่ใบขน: <code>${escapeHtml(cap(declaration_no, 40) || '-')}</code>\n` +
                  `• ประเภทสินค้า: ${escapeHtml(cap(goods_type, 80) || '-')}\n` +
                  `• ทะเบียนรถ: ${escapeHtml(cap(plates, 400) || '-')}\n` +
                  `• ผลต่างน้ำหนัก: ${escapeHtml(cap(diff_text, 80) || '-')}`;
    await sendTelegramNotification(tgMsg);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[NOTIFY ERROR]', err.message);
    return res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาด' });
  }
};
