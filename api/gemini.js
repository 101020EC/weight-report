// api/gemini.js — Vercel Serverless Function
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── API Key Rotation ──────────────────────────────────────
// เพิ่ม key ใน Vercel Environment Variables:
// GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3
function getApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY, // fallback key เดิม
  ].filter(k => k && k.length > 0);
  return keys;
}

function normalizeOriginToThai(origin) {
  if (!origin || typeof origin !== 'string') return origin || '';
  const trimmed = origin.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes('china') || lower.includes('chinese') || lower === 'cn') return 'จีน';
  if (lower.includes('india') || lower.includes('indian') || lower === 'in') return 'อินเดีย';
  if (lower.includes('netherland') || lower.includes('holland') || lower === 'nl') return 'เนเธอร์แลนด์';
  if (lower.includes('egypt') || lower === 'eg') return 'อียิปต์';
  if (lower.includes('vietnam') || lower.includes('viet nam') || lower === 'vn') return 'เวียดนาม';
  if (lower.includes('myanmar') || lower.includes('burma') || lower === 'mm') return 'เมียนมา';
  if (lower.includes('pakistan') || lower === 'pk') return 'ปากีสถาน';
  if (lower.includes('indonesia') || lower === 'id') return 'อินโดนีเซีย';
  if (lower.includes('malaysia') || lower === 'my') return 'มาเลเซีย';
  if (lower.includes('australia') || lower === 'au') return 'ออสเตรเลีย';
  if (lower.includes('new zealand') || lower === 'nz') return 'นิวซีแลนด์';
  if (lower.includes('usa') || lower.includes('united states') || lower === 'us') return 'สหรัฐอเมริกา';
  if (lower.includes('japan') || lower === 'jp') return 'ญี่ปุ่น';
  if (lower.includes('korea') || lower === 'kr') return 'เกาหลีใต้';
  if (lower.includes('taiwan') || lower === 'tw') return 'ไต้หวัน';

  return trimmed;
}

// สุ่ม key จาก pool แล้ว retry ถ้า quota หมด
async function callGeminiWithRotation(parts) {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('ไม่พบ API Key ใน Environment Variables');

  // สุ่ม key แรก
  const shuffled = [...keys].sort(() => Math.random() - 0.5);

  let lastError = null;
  for (const key of shuffled) {
    try {
      const resp = await fetch(`${GEMINI_URL}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });

      if (!resp.ok) {
        const err = await resp.json();
        const msg = err.error?.message || `HTTP ${resp.status}`;
        // ถ้า quota หมด ลอง key ถัดไป
        if (resp.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          lastError = new Error(`Key quota หมด: ${msg}`);
          continue;
        }
        throw new Error(msg);
      }

      const data = await resp.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return raw;

    } catch (e) {
      // quota error ลอง key ถัดไป
      if (e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED') || e.message.includes('429')) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('API Key ทุกตัว quota หมดแล้ว กรุณาลองใหม่พรุ่งนี้');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Telegram Notification Helper ────────────────────────────
async function sendTelegramNotification(message) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId   = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    console.warn(`[TELEGRAM LOG WARNING] Missing env vars. BOT_TOKEN exists: ${!!botToken}, CHAT_ID exists: ${!!chatId}`);
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
      console.warn(`[TELEGRAM HTML ERROR] HTTP ${resp.status}: ${errRes} — Attempting Plaintext Fallback...`);
      // ถ้า HTML parse error ให้ส่งแบบ Plaintext ไม่ใส่ parse_mode
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
    } else {
      console.log('[TELEGRAM LOG SUCCESS] Message sent to Telegram successfully');
      return { success: true };
    }
  } catch (err) {
    console.error('[TELEGRAM LOG ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = async function handler(req, res) {
  const startTime = Date.now();
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  // CORS — จำกัดเฉพาะโดเมนแอป กันเว็บอื่นยิง API เผา quota Gemini
  const ALLOWED_ORIGINS = [
    'https://weight-report.vercel.app',
  ];
  const origin = req.headers.origin || '';
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  if (isAllowedOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // ถ้าเป็น request จากเบราว์เซอร์โดเมนอื่น (มี Origin แต่ไม่อยู่ใน allowlist) ให้ปฏิเสธ
  if (origin && !isAllowedOrigin) {
    return res.status(403).json({ success: false, error: 'Origin not allowed' });
  }

  const keys = getApiKeys();
  if (keys.length === 0) {
    const err = 'ไม่พบ API Key ใน Environment Variables';
    console.error(`[ERROR] IP: ${clientIp} | ${err}`);
    await sendTelegramNotification(`🚨 <b>[API ERROR]</b>\nError: ${err}`);
    return res.status(500).json({ success: false, error: err });
  }

  try {
    const { type, images } = req.body;
    console.log(`[REQUEST] IP: ${clientIp} | Type: ${type} | Images: ${images?.length || 0}`);

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลภาพ' });
    }

    // สร้าง parts จากรูปภาพ โดยใส่ป้ายกำกับแยกแต่ละภาพชัดเจน
    const parts = [];
    images.forEach((img, idx) => {
      parts.push({ text: `[ภาพเอกสารที่ ${idx + 1}]` });
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    });

    // เพิ่ม prompt ตาม type
    if (type === 'weight') {
      parts.push({ text: PROMPT_WEIGHT });
    } else if (type === 'team') {
      parts.push({ text: PROMPT_TEAM });
    } else {
      return res.status(400).json({ success: false, error: 'type ไม่ถูกต้อง' });
    }

    // เรียก Gemini ด้วย key rotation
    const raw = await callGeminiWithRotation(parts);
    const duration = Date.now() - startTime;

    // ประมวลผลตาม type
    // helper: extract JSON จาก response ที่อาจมี text อื่นปน
    function extractJSON(rawText) {
      try { return JSON.parse(rawText.trim()); } catch(e) {}
      let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try { return JSON.parse(clean); } catch(e) {}
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch(e) {}
      }
      throw new Error('อ่าน JSON ไม่ได้ raw: ' + rawText.slice(0, 200));
    }

    if (type === 'weight') {
      const parsed = extractJSON(raw);
      if (parsed.origin) {
        parsed.origin = normalizeOriginToThai(parsed.origin);
      }
      console.log(`[SUCCESS weight] IP: ${clientIp} | Duration: ${duration}ms | Declaration: ${parsed.declaration_no || '-'} | Importer: ${parsed.importer || '-'}`);

      // ส่ง Telegram แจ้งเตือนสำเร็จ
      try {
        const dateStr = escapeHtml(parsed.date || '-');
        const importerStr = escapeHtml(parsed.importer || '-');
        const declNoStr = escapeHtml(parsed.declaration_no || '-');
        const goodsTypeStr = escapeHtml(parsed.goods_type || 'สินค้า');
        const numWeight = parseFloat(String(parsed.declared_weight || '').replace(/,/g, ''));
        const declWeightStr = !isNaN(numWeight) && numWeight > 0 ? numWeight.toLocaleString('en-US') + ' KG' : '-';
        const vehCount = Array.isArray(parsed.vehicles) ? parsed.vehicles.length : 0;

        const tgMsg = `⚖️ <b>[อ่านใบชั่งน้ำหนักสำเร็จ]</b>\n` +
                      `• วันที่: ${dateStr}\n` +
                      `• ผู้นำเข้า: ${importerStr}\n` +
                      `• เลขที่ใบขน: <code>${declNoStr}</code>\n` +
                      `• ประเภทสินค้า: ${goodsTypeStr}\n` +
                      `• จำนวนรถ: ${vehCount} คัน\n` +
                      `⏱ เวลาประมวลผล: ${(duration / 1000).toFixed(2)}s`;
        await sendTelegramNotification(tgMsg);
      } catch (tgErr) {
        console.error('[TELEGRAM WEIGHT LOG ERROR]', tgErr.message);
      }

      return res.status(200).json({ success: true, data: parsed });

    } else if (type === 'team') {
      const parsed = extractJSON(raw);

      const date  = parsed.date || '';
      const rawDecls = parsed.declarations || [];

      // ตัดใบขนที่เลขซ้ำออก (เก็บใบแรก) + เก็บเลขที่ซ้ำไว้แจ้งเตือน
      const warnings = [];
      const seenNo = new Set();
      const dupNos = new Set();
      const decls = [];
      rawDecls.forEach(d => {
        if (d.origin) {
          d.origin = normalizeOriginToThai(d.origin);
        }
        const key = (d.no || '').trim();
        if (key !== '') {
          if (seenNo.has(key)) { dupNos.add(key); return; }
          seenNo.add(key);
        }
        decls.push(d);
      });
      const count = decls.length;
      dupNos.forEach(no => warnings.push(`เลขใบขน ${no} ซ้ำ — แสดงครั้งเดียว`));

      // ตรวจหาข้อมูลขาด
      const REQUIRED = { no:'เลขที่ใบขนสินค้า', goods:'สินค้า', origin:'เมืองกำเนิด', qty:'จำนวน', weight:'น้ำหนัก' };
      decls.forEach((d, i) => {
        const missing = Object.entries(REQUIRED)
          .filter(([k]) => String(d[k] ?? '').trim() === '')
          .map(([, label]) => label);
        if (missing.length > 0) {
          warnings.push(`ใบขนที่ ${i+1} (${d.no||'ไม่ทราบเลข'}) ขาด: ${missing.join(', ')}`);
        }
      });

      // รวมน้ำหนักหน้าใบขนแยกตามประเภทสินค้า
      const weightByGoods = {};
      decls.forEach(d => {
        const g = String(d.goods ?? 'ไม่ระบุ').trim() || 'ไม่ระบุ';
        const w = parseFloat(String(d.weight ?? '0').replace(/,/g, '')) || 0;
        weightByGoods[g] = (weightByGoods[g] || 0) + w;
      });

      console.log(`[SUCCESS team] IP: ${clientIp} | Duration: ${duration}ms | Count: ${count} ใบขน`);

      // ส่ง Telegram แจ้งเตือนสำเร็จ
      try {
        const goodsSummaryLines = Object.entries(weightByGoods)
          .map(([g, w]) => `  • ${escapeHtml(g)}: ${w > 0 ? w.toLocaleString('en-US') + ' KG' : '-'}`)
          .join('\n');

        const declNosList = decls.map(d => escapeHtml(d.no)).filter(Boolean).map(no => `<code>${no}</code>`).join(', ');

        const tgMsg = `👥 <b>[อ่านใบขนรายงานตรวจทีมสำเร็จ]</b>\n` +
                      `• วันที่: ${escapeHtml(date) || '-'}\n` +
                      `• จำนวนใบขน: ${count} ใบขน\n` +
                      `• เลขที่ใบขน: ${declNosList || '-'}\n` +
                      `• น้ำหนักหน้าใบขนรวมแยกตามสินค้า:\n${goodsSummaryLines || '  • -'}\n` +
                      `⏱ เวลาประมวลผล: ${(duration / 1000).toFixed(2)}s`;
        await sendTelegramNotification(tgMsg);
      } catch (tgErr) {
        console.error('[TELEGRAM TEAM LOG ERROR]', tgErr.message);
      }

      // สร้างข้อความรายงาน
      let text = `${date}\n`;
      text += `เจ้าหน้าที่งานพิธีการ ร่วมกับเจ้าหน้าที่งานสืบสวนและปราบปราม เปิดตรวจสินค้าเป็นทีม สินค้าเกษตร ใบขนสินค้าขาเข้าจำนวน ${count} ใบขน ดังนี้`;
      decls.forEach((d, i) => {
        text += `\n\n${i+1}.${d.no||''}`;
        text += `\nสินค้า ${d.goods||''}`;
        text += `\nเมืองกำเนิด ${d.origin||''}`;
        text += `\nจำนวน ${d.qty||''} กระสอบ`;
        text += `\nน้ำหนัก ${d.weight||''} กิโลกรัม`;
      });

      return res.status(200).json({ success: true, text: text.trim(), warnings });
    }

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[ERROR] IP: ${clientIp} | Duration: ${duration}ms | Msg: ${err.message}`);

    const tgMsg = `🚨 <b>[API ERROR]</b>\n` +
                  `• Error: ${escapeHtml(err.message || 'เกิดข้อผิดพลาด')}\n` +
                  `⏱ เวลาใช้ไป: ${(duration / 1000).toFixed(2)}s`;
    await sendTelegramNotification(tgMsg);

    return res.status(500).json({ success: false, error: err.message || 'เกิดข้อผิดพลาด' });
  }
}

// ── PROMPTS ───────────────────────────────────────────────

const PROMPT_WEIGHT = `คุณคือระบบอ่านใบชั่งน้ำหนักสินค้า ปาดังเบซาร์
อ่านข้อมูลจากภาพอย่างละเอียด

กฎสำคัญ:
- importer: อ่านชื่อผู้นำเข้าจากเอกสาร ถ้ามีคำว่า "ดิเรก" ในชื่อให้ใส่ "ดิเรก", "ติก๊ะ" ให้ใส่ "ติก๊ะ", "ก๊ะลี" หรือ "กะลี" ให้ใส่ "ก๊ะลี" ถ้าไม่ตรงให้ใส่ชื่อจากเอกสารตามที่เห็น
- ห้ามคำนวณ declared_weight จากน้ำหนักชั่งลบน้ำหนักรถ
- ถ้าไม่พบข้อความน้ำหนักหน้าใบขนในเอกสาร ให้ใส่ null
- อ่านทะเบียนรถให้ครบ รวมอักษรภาษาไทยนำหน้า เช่น "พน 8580" "70-1216"
- origin: ประเทศกำเนิดสินค้า ต้องเป็นภาษาไทยเท่านั้น เช่น จีน, อินเดีย, เนเธอร์แลนด์ (ถ้าเห็นเป็นภาษาอังกฤษ เช่น CHINA ให้แปลเป็นภาษาไทย จีน) หรือ null ถ้าไม่พบ

ส่งกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{
  "importer": "ชื่อผู้นำเข้า",
  "declaration_no": "เลขที่ใบขน รูปแบบ A000-00000-00000",
  "declared_weight": ตัวเลข KG จากเอกสารเท่านั้น หรือ null ถ้าไม่พบ,
  "date": "วันที่เต็ม เช่น 25 มิถุนายน 2569",
  "goods_type": "หอม หรือ กระเทียม",
  "origin": "ประเทศกำเนิดสินค้าภาษาไทย หรือ null ถ้าไม่พบ",
  "period": "ชุดที่ หรือ ช่วง ถ้ามี หรือ null",
  "vehicles": [
    {
      "plate": "ทะเบียนรถเต็ม รวมอักษรนำหน้า",
      "empty_weight": KG,
      "gross_weight": KG,
      "net_weight": KG
    }
  ]
}
net_weight=gross_weight-empty_weight, ตัวเลขไม่มี comma, ไม่พบข้อมูลใส่ null`;

const PROMPT_TEAM = `คุณคือระบบอ่านใบขนสินค้าและรายงานใบชั่งน้ำหนัก ปาดังเบซาร์

อ่านข้อมูลจากภาพเอกสารแต่ละภาพอย่างละเอียดและถูกต้อง โดยแยกตามแต่ละเอกสาร (ภาพเอกสารที่ 1, ภาพเอกสารที่ 2, ...):

สร้าง JSON ในรูปแบบนี้เท่านั้น:
{
  "date": "วันที่เต็ม เช่น 29 พฤษภาคม 2569",
  "declarations": [
    {
      "no": "เลขที่ใบขน เช่น A025-06905-16573",
      "goods": "ชื่อสินค้าภาษาไทยเท่านั้น ไม่มีอังกฤษ (เช่น หอม หรือ กระเทียม)",
      "origin": "เมืองกำเนิดหรือประเทศกำเนิดภาษาไทยเท่านั้น",
      "qty": "จำนวนหน่วย ตัวเลขจำนวนเต็มใช้ , คั่นหลักพัน",
      "weight": "น้ำหนัก KG ตัวเลขจำนวนเต็มใช้ , คั่นหลักพัน"
    }
  ]
}

กฎสำคัญสำหรับเมืองกำเนิด (origin):
- เมืองกำเนิด (origin) ต้องอ่านจากเอกสารของใบขนฉบับนั้นๆ โดยตรง ห้ามนำเมืองกำเนิดจากใบขนหนึ่งไปใส่ให้อีกใบขนหนึ่งเด็ดขาด (เช่น หากภาพที่ 1 เป็น จีน และภาพที่ 2 เป็น อินเดีย ต้องระบุแยกให้ตรงตามภาพนั้นๆ)
- เมืองกำเนิดต้องแปลเป็นภาษาไทยเท่านั้น เช่น "จีน", "อินเดีย", "เนเธอร์แลนด์", "อียิปต์", "เวียดนาม", "เมียนมา", "ปากีสถาน" (หากเอกสารระบุ CHINA ให้แปลเป็น จีน, INDIA ให้แปลเป็น อินเดีย)

กฎน้ำหนัก:
- ถ้าภาพเป็นรายงานสรุปน้ำหนักหอม กระเทียม ให้ใช้ "น้ำหนักหน้าใบขนสินค้า" (declared weight)
- ถ้าภาพเป็นใบขนสินค้าโดยตรง ให้ใช้น้ำหนักสินค้าจากใบขน

กฎอื่นๆ:
- อ่านเรียงตามลำดับภาพเอกสาร (1 ใบขน ต่อ 1 ภาพหรือตามเอกสารจริง)
- ห้ามเดาหรือสมมติข้อมูลข้ามใบขน
- ถ้าไม่พบข้อมูลใดให้ใส่ "" (string ว่าง) ห้ามใส่ null
- วันที่ใช้จากใบขน ถ้าหลายใบใช้วันที่แรก
- ตัวเลขจำนวนเต็ม ไม่มีทศนิยม ใช้ , คั่นหลักพัน
- เลขใบขนรูปแบบ A000-00000-00000
- ส่งกลับ JSON เท่านั้น ห้ามมีข้อความอื่น`;
