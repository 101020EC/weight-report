// api/notify.js — Vercel Serverless Function สำหรับส่ง Telegram แจ้งเตือนเมื่อกดสร้างรายงาน

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      console.warn(`[TELEGRAM HTML ERROR] HTTP ${resp.status}: ${errRes} — Fallback to Plaintext...`);
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { action, declaration_no, importer, date, goods_type, total_net, declared_weight, diff_text, vehicle_count } = req.body;

    if (action === 'report_created') {
      const dateStr = escapeHtml(date || '-');
      const importerStr = escapeHtml(importer || '-');
      const declNoStr = escapeHtml(declaration_no || '-');
      const goodsTypeStr = escapeHtml(goods_type || '-');
      const diffTextStr = escapeHtml(diff_text || '-');

      const tgMsg = `📋 <b>[สร้างรายงานชั่งน้ำหนักสำเร็จ]</b>\n` +
                    `• วันที่: ${dateStr}\n` +
                    `• ผู้นำเข้า: ${importerStr}\n` +
                    `• เลขที่ใบขน: <code>${declNoStr}</code>\n` +
                    `• ประเภทสินค้า: ${goodsTypeStr}\n` +
                    `• จำนวนรถ: ${vehicle_count || 0} คัน\n` +
                    `• น้ำหนักสุทธิรวม: ${Number(total_net || 0).toLocaleString('en-US')} KG\n` +
                    `• น้ำหนักหน้าใบขน: ${declared_weight ? Number(declared_weight).toLocaleString('en-US') + ' KG' : '-'}\n` +
                    `• ผลต่างน้ำหนัก: ${diffTextStr}`;

      await sendTelegramNotification(tgMsg);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
