// ── Gemini models (V27) ───────────────────────────────────
// โมเดลฟรีของ Google (หน้าราคา 2026-10-15) เรียงตามลำดับที่ลอง — ชุดเดียวกับ customshub D65.
// Google เปลี่ยนรุ่นฟรีเมื่อไหร่ แก้บรรทัดนี้แล้ว push (ด่วน: ตั้ง GEMINI_MODEL ใน Vercel แล้ว redeploy ให้ขึ้นก่อน)
// โมเดลไหนตอบ 404 = ถูกปลดแล้ว → Telegram เตือนวันละครั้งต่อโมเดล
const FREE_MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];
function modelOrder() {
  return [...new Set([process.env.GEMINI_MODEL, ...FREE_MODELS].map(m => (m || '').trim()).filter(Boolean))];
}
const PER_CALL_MS = 25000; // เกินนี้ข้ามไปโมเดลถัดไป
const BUDGET_MS = 55000;   // รวมทุกโมเดล (vercel.json maxDuration 60)

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

function formatIntNumberWithComma(val) {
  if (val == null || val === '') return '';
  let str = String(val).trim();
  // หากมีจุดทศนิยม ให้ตัดส่วนหลังจุดทศนิยมออกก่อน (ป้องกัน 14,000.000 กลายเป็น 14,000,000)
  if (str.includes('.')) {
    str = str.split('.')[0];
  }
  const numOnly = str.replace(/[^0-9]/g, '');
  if (!numOnly) return '';
  return Number(numOnly).toLocaleString('en-US');
}

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
function formatThaiDateFromIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  return `${+m[3]} ${THAI_MONTHS_FULL[+m[2] - 1]} ${+m[1] + 543}`;
}
function todayBangkokIso() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

class GeminiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// thinking ทำให้ช้าหลายวินาที งานนี้แค่อ่านตัวเลขจากรูป — 3.x flash: low, 2.5 flash: 0, อื่นๆ ปล่อยตามโมเดล (customshub D57)
function thinkingFor(model) {
  const v = Number((model.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
  if (!/flash/.test(model)) return null;
  if (v >= 3) return { thinkingLevel: 'low' };
  if (v >= 2.5) return { thinkingBudget: 0 };
  return null;
}

// สุ่มลำดับคีย์ แล้วไล่โมเดลตามลำดับบนคีย์นั้น — โควตาฟรีนับต่อโมเดล 429 จึงไปโมเดลถัดไปคีย์เดิม;
// คีย์หมดจริงเมื่อทุกโมเดลตอบ 429 แล้วจึงไปคีย์ถัดไป. คืน { raw, modelUsed, gone } (gone = โมเดลที่ตอบ 404)
async function callGeminiWithRotation(parts, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const keys = opts.keys || getApiKeys();
  const models = opts.models || modelOrder();
  const perCall = opts.perCall || PER_CALL_MS;
  const budget = opts.budget || BUDGET_MS;
  if (keys.length === 0) throw new GeminiError(500, 'ไม่พบ API Key ใน Environment Variables');

  const start = Date.now();
  const shuffled = [...keys].sort(() => Math.random() - 0.5);
  const gone = new Set();
  let quota = 0, slow = 0, other = null, keyErr = null;

  for (const key of shuffled) {
    for (const model of models) {
      if (gone.has(model)) continue;
      const left = budget - (Date.now() - start);
      if (left <= 0) throw new GeminiError(504, 'AI ตอบช้าเกินไป ลองใหม่หรือกด Manual', { gone: [...gone] });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.min(perCall, left));
      try {
        const think = thinkingFor(model);
        const body = { contents: [{ parts }], ...(think ? { generationConfig: { thinkingConfig: think } } : {}) };
        const resp = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          const msg = err.error?.message || `HTTP ${resp.status}`;
          if (resp.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) { quota++; continue; }
          if (resp.status === 404 || err.error?.status === 'NOT_FOUND') {
            console.warn(`[GEMINI MODEL GONE] ${model}: ${msg}`);
            gone.add(model);
            continue;
          }
          // คีย์เสีย/ถูกปิด → คีย์ถัดไป (คีย์อื่นอาจยังดี)
          if (resp.status === 401 || resp.status === 403 || /API.?KEY/i.test(msg + (err.error?.details?.[0]?.reason || ''))) {
            console.warn(`[GEMINI BAD KEY] ${msg}`);
            keyErr = new GeminiError(502, `คีย์ Gemini ใช้ไม่ได้: ${msg}`);
            break;
          }
          if (resp.status >= 500) { other = new GeminiError(502, `${model}: ${msg}`); continue; } // โมเดลล่ม/คนแน่น → ตัวถัดไป
          throw new GeminiError(resp.status === 400 ? 400 : 502, msg, { gone: [...gone], final: true }); // รูป/คำขอผิด ลองตัวอื่นก็ผิดเหมือนกัน
        }
        const data = await resp.json();
        const raw = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (raw) return { raw, modelUsed: model, gone: [...gone] };
        other = new GeminiError(502, `${model}: ไม่มีข้อความตอบกลับ`);
      } catch (e) {
        if (e.final) throw e;
        if (e.name === 'AbortError') { slow++; console.warn(`[GEMINI TIMEOUT] ${model}`); continue; }
        other = e instanceof GeminiError ? e : new GeminiError(502, e.message);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  const g = { gone: [...gone] };
  if (other) throw Object.assign(other, g);
  if (quota) throw new GeminiError(429, 'โควตา Gemini ฟรีวันนี้หมดแล้ว กด Manual เพื่อกรอกเอง', { ...g, quota: true });
  if (slow) throw new GeminiError(504, 'AI ตอบช้าเกินไป ลองใหม่หรือกด Manual', g);
  if (keyErr) throw Object.assign(keyErr, g);
  throw new GeminiError(502, 'ไม่มีโมเดล Gemini ที่ใช้ได้ — ตรวจรายชื่อ FREE_MODELS', g);
}

// โมเดลใน FREE_MODELS ตอบ 404 → Telegram วันละครั้งต่อโมเดล (จำวันที่ใน Firestore settings/aiAlerts)
let _db = null;
function db() {
  if (_db) return _db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT');
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
  _db = getFirestore();
  return _db;
}
async function alertGoneModels(gone) {
  if (!gone || !gone.length) return;
  try {
    const today = todayBangkokIso();
    const ref = db().collection('settings').doc('aiAlerts');
    const fresh = await db().runTransaction(async tx => {
      const seen = (await tx.get(ref)).data() || {};
      const list = gone.filter(m => seen[m] !== today);
      if (list.length) tx.set(ref, Object.fromEntries(list.map(m => [m, today])), { merge: true });
      return list;
    });
    if (!fresh.length) return;
    await sendTelegramNotification(
      `⚠️ <b>[GEMINI MODEL GONE]</b>\n` +
      `• โมเดลที่ Google ตอบ 404: ${escapeHtml(fresh.join(', '))}\n` +
      `• แก้รายชื่อ FREE_MODELS ใน api/gemini.js แล้ว push (หรือตั้ง GEMINI_MODEL ใน Vercel + redeploy)`
    );
  } catch (e) {
    console.error('[GEMINI GONE ALERT ERROR]', e.message);
  }
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
    const { raw, modelUsed, gone } = await callGeminiWithRotation(parts);
    await alertGoneModels(gone);
    const duration = Date.now() - startTime;
    const isFallback = (modelUsed !== modelOrder()[0]);

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
      if (parsed.declared_weight != null) {
        let str = String(parsed.declared_weight).trim();
        if (str.includes('.')) str = str.split('.')[0];
        const numOnly = str.replace(/[^0-9]/g, '');
        parsed.declared_weight = numOnly ? Number(numOnly) : null;
      }
      if (parsed.origin) {
        parsed.origin = normalizeOriginToThai(parsed.origin);
      }
      console.log(`[SUCCESS weight] IP: ${clientIp} | Model: ${modelUsed}${isFallback ? ' (FALLBACK)' : ''} | Duration: ${duration}ms | Declaration: ${parsed.declaration_no || '-'} | Importer: ${parsed.importer || '-'}`);

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
                      `• โมเดลที่ใช้: ${modelUsed}${isFallback ? ' ⚠️ (Fallback)' : ''}\n` +
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

      return res.status(200).json({ 
        success: true, 
        data: parsed, 
        model_used: modelUsed, 
        is_fallback: isFallback 
      });

    } else if (type === 'team') {
      const parsed = extractJSON(raw);

      // วันที่จาก body (Date Picker) หรือ fallback เป็นวันปัจจุบันตามเวลาไทย
      const dateRaw = (req.body && req.body.date ? String(req.body.date) : '').trim() || todayBangkokIso();
      const date = formatThaiDateFromIso(dateRaw);
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
        if (d.weight) {
          d.weight = formatIntNumberWithComma(d.weight);
        }
        if (d.qty) {
          d.qty = formatIntNumberWithComma(d.qty);
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

      console.log(`[SUCCESS team] IP: ${clientIp} | Model: ${modelUsed}${isFallback ? ' (FALLBACK)' : ''} | Duration: ${duration}ms | Count: ${count} ใบขน`);

      // ส่ง Telegram แจ้งเตือนสำเร็จ
      try {
        const goodsSummaryLines = Object.entries(weightByGoods)
          .map(([g, w]) => `  • ${escapeHtml(g)}: ${w > 0 ? w.toLocaleString('en-US') + ' KG' : '-'}`)
          .join('\n');

        const declNosList = decls.map(d => escapeHtml(d.no)).filter(Boolean).map(no => `<code>${no}</code>`).join(', ');

        const tgMsg = `👥 <b>[อ่านใบขนรายงานตรวจทีมสำเร็จ]</b>\n` +
                      `• โมเดลที่ใช้: ${modelUsed}${isFallback ? ' ⚠️ (Fallback)' : ''}\n` +
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

      return res.status(200).json({ 
        success: true, 
        text: text.trim(), 
        warnings, 
        model_used: modelUsed, 
        is_fallback: isFallback 
      });
    }

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[ERROR] IP: ${clientIp} | Duration: ${duration}ms | Msg: ${err.message}`);

    const tgMsg = `🚨 <b>[API ERROR]</b>\n` +
                  `• Error: ${escapeHtml(err.message || 'เกิดข้อผิดพลาด')}\n` +
                  `⏱ เวลาใช้ไป: ${(duration / 1000).toFixed(2)}s`;
    await sendTelegramNotification(tgMsg);
    await alertGoneModels(err.gone);

    return res.status(err.status || 500).json({ success: false, error: err.message || 'เกิดข้อผิดพลาด', ...(err.quota ? { quota: true } : {}) });
  }
}
module.exports._test = { callGeminiWithRotation, thinkingFor, modelOrder, FREE_MODELS };

// ── PROMPTS ───────────────────────────────────────────────

const PROMPT_WEIGHT = `คุณคือระบบอ่านใบชั่งน้ำหนักสินค้า ปาดังเบซาร์
อ่านข้อมูลจากภาพอย่างรายละเอียด

กฎสำคัญ:
- importer: อ่านชื่อผู้นำเข้าจากเอกสาร ถ้ามีคำว่า "ดิเรก" ในชื่อให้ใส่ "ดิเรก", "ติก๊ะ" ให้ใส่ "ติก๊ะ", "ก๊ะลี" หรือ "กะลี" ให้ใส่ "ก๊ะลี" ถ้าไม่ตรงให้ใส่ชื่อจากเอกสารตามที่เห็น
- goods_type: อ่านและระบุชื่อสินค้าภาษาไทยให้ตรงตามเอกสารฉบับนั้นๆ โดยตรง ห้ามเดาหรือเปลี่ยนคำ (เช่น "หอมหัวใหญ่", "หอมสด", "หอม", "กระเทียม")
- declared_weight: ตัวเลข KG จากเอกสารเท่านั้น (ระวังจุดทศนิยม: หากเอกสารระบุ 14,000.00 หรือ 14,000.000 ให้ใช้เฉพาะส่วนจำนวนเต็ม 14000 ห้ามนำเลข 0 หลังจุดทศนิยมมารวมเป็น 14000000)
- ห้ามคำนวณ declared_weight จากน้ำหนักชั่งลบน้ำหนักรถ
- ถ้าไม่พบข้อความน้ำหนักหน้าใบขนในเอกสาร ให้ใส่ null
- อ่านทะเบียนรถให้ครบ รวมอักษรภาษาไทยนำหน้าหรือหมวดตัวเลข เช่น "พน 8580" "70-1216" "71-5778" "72-0071"
- ระวังลายมือทะเบียนรถ: ทะเบียนรถบรรทุกขนส่งในไทยส่วนใหญ่ใช้หมวด 70, 71, 72, 73, 80-89 (เช่น 71-5778) ลายมือเลข 7 ที่มีม้วนหัวขีดบนซ้าย ห้ามอ่านผิดเป็นเลข 9 (เช่น 71-5778 ห้ามอ่านเป็น 91-5778)
- origin: ประเทศกำเนิดสินค้า ต้องเป็นภาษาไทยเท่านั้น เช่น จีน, อินเดีย, เนเธอร์แลนด์ (ถ้าเห็นเป็นภาษาอังกฤษ เช่น CHINA ให้แปลเป็นภาษาไทย จีน) หรือ null ถ้าไม่พบ
- การอ่านตารางน้ำหนักรถ (vehicles):
  1. ช่อง "นน.รถเปล่า" ให้แมปเข้า "empty_weight"
  2. ช่อง "นน.ชั่งได้" ให้แมปเข้า "gross_weight"
  3. ช่อง "นน.สุทธิ" ให้แมปเข้า "net_weight" (ถ้าเอกสารไม่มีช่องนี้ ให้คำนวณ net_weight = gross_weight - empty_weight)
  4. ห้ามนำค่าจากช่อง "นน.ชั่งได้" ไปใส่ใน "net_weight" แล้วคำนวณย้อนสร้างตัวเลขอื่นขึ้นมาเองเด็ดขาด
  5. ระวังเรื่องลายมือตัวเลข: เลข 1 หน้าสุดในน้ำหนักรถเปล่า (เช่น 13,180 หรือ 13,390) มีขีดหัวลง ห้ามอ่านเป็นเลข 7 (เช่น 73,180) น้ำหนักรถเปล่ามักอยู่ในช่วง 10,000 - 20,000 KG

ส่งกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{
  "importer": "ชื่อผู้นำเข้า",
  "declaration_no": "เลขที่ใบขน รูปแบบ A000-00000-00000",
  "declared_weight": ตัวเลข KG จากเอกสารเท่านั้น หรือ null ถ้าไม่พบ,
  "date": "วันที่เต็ม เช่น 25 มิถุนายน 2569",
  "goods_type": "ชื่อสินค้าภาษาไทยตรงตามเอกสาร",
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

const PROMPT_TEAM = `คุณคือระบบอ่านใบขนสินค้าขาเข้า (แบบ กศก. 09/01) ด่านศุลกากรปาดังเบซาร์

อ่านข้อมูลจากภาพเอกสารใบขนสินค้า โดยแต่ละภาพเอกสาร (ภาพเอกสารที่ 1, ภาพเอกสารที่ 2, ...) คือใบขนสินค้า 1 ฉบับ มีสินค้าเกษตร 1 รายการเท่านั้น

ดึงข้อมูลเฉพาะ 5 ตำแหน่งตามแบบฟอร์มใบขนสินค้าอย่างเคร่งครัด ดังนี้:
1. เลขที่ใบขนสินค้า (no): ดูที่กล่องมุมบนขวา "เลขที่ใบขนสินค้า" ดึงเฉพาะรหัสรูปแบบ A0XX-XXXXX-XXXXX (เช่น A018-06909-07124) ห้ามนำเลข DOTS... หรือข้อความอื่นมาใส่
2. จำนวนและลักษณะหีบห่อ (qty): ดูที่กล่อง "จำนวนและลักษณะหีบห่อ" ตรงกลางด้านซ้าย ดึงเฉพาะตัวเลขจำนวนเต็ม เช่น 4,632 (ใส่เครื่องหมาย comma คั่นหลักพัน ห้ามใส่คำว่า Bag หรือคำอื่น)
3. ประเทศกำเนิด (origin): ดูที่กล่อง "ประเทศกำเนิด" ตรงกลาง แปลเป็นภาษาไทยเท่านั้น เช่น INDIA -> "อินเดีย", CHINA -> "จีน", EGYPT -> "อียิปต์", VIETNAM -> "เวียดนาม", PAKISTAN -> "ปากีสถาน", MYANMAR -> "เมียนมา"
4. น้ำหนักสุทธิ (weight): ดูที่ตารางรายการสินค้า คอลัมน์ "น้ำหนักสุทธิ" ดึงเฉพาะตัวเลขจำนวนเต็มหน้าจุดทศนิยม เช่น 44,004.000 KGM ให้ดึงเฉพาะ 44,004 (ใส่ comma คั่นหลักพัน ห้ามนำเลขทศนิยม .000 หรือหน่วย KGM มาใส่เด็ดขาด)
5. ชื่อสินค้า (goods): ดูที่ตารางรายการสินค้า คอลัมน์ "รายละเอียดสินค้า" ดึงเฉพาะชื่อสินค้าภาษาไทย เช่น "หอมหัวใหญ่", "กระเทียมสด" (ห้ามนำเลขใบอนุญาต, ข้อความภาษาอังกฤษ, หรือข้อความกำกับอื่นมาใส่)

กฎสำคัญอย่างยิ่ง:
- ละเว้น/เพิกเฉยต่อข้อมูลส่วนอื่นๆ ทั้งหมดในใบขนสินค้า เช่น ชื่อผู้นำเข้า, อัตราภาษีอากร, ค่าธรรมเนียม, ราคาของ, พิกัดศุลกากร, วันที่ชำระเงิน, เลขที่ B/L, ลายมือชื่อเจ้าหน้าที่ศุลกากร และตารางสรุปภาษีด้านล่างทั้งหมด
- ห้ามเดาหรือสมมติข้อมูล ถ้าไม่พบข้อมูลช่องใดให้ใส่ "" (string ว่าง)
- ตัวเลข qty และ weight ต้องเป็นจำนวนเต็ม มี comma คั่นหลักพัน ไม่มีจุดทศนิยม

สร้าง JSON ในรูปแบบนี้เท่านั้น:
{
  "declarations": [
    {
      "no": "A018-06909-07124",
      "goods": "หอมหัวใหญ่",
      "origin": "อินเดีย",
      "qty": "4,632",
      "weight": "44,004"
    }
  ]
}
ส่งกลับ JSON เท่านั้น ห้ามมีข้อความอื่น`;
