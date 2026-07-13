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

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const keys = getApiKeys();
  if (keys.length === 0) return res.status(500).json({ success: false, error: 'ไม่พบ API Key ใน Environment Variables' });

  try {
    const { type, images } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลภาพ' });
    }

    // สร้าง parts จากรูปภาพ
    const parts = images.map(img => ({
      inline_data: { mime_type: img.mimeType, data: img.data }
    }));

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

    // ประมวลผลตาม type
    // helper: extract JSON จาก response ที่อาจมี text อื่นปน
    function extractJSON(raw) {
      // ลอง parse ตรงๆ ก่อน
      try {
        return JSON.parse(raw.trim());
      } catch(e) {}
      // ลบ markdown code blocks
      let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        return JSON.parse(clean);
      } catch(e) {}
      // หา JSON object ที่ใหญ่ที่สุดในข้อความ
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch(e) {}
      }
      throw new Error('อ่าน JSON ไม่ได้ raw: ' + raw.slice(0, 200));
    }

    if (type === 'weight') {
      const parsed = extractJSON(raw);
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
          .filter(([k]) => !d[k] || d[k].trim() === '')
          .map(([, label]) => label);
        if (missing.length > 0) {
          warnings.push(`ใบขนที่ ${i+1} (${d.no||'ไม่ทราบเลข'}) ขาด: ${missing.join(', ')}`);
        }
      });

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
    console.error('Gemini error:', err.message);
    const msg = err.message || 'เกิดข้อผิดพลาด';
    return res.status(500).json({ success: false, error: msg });
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

ส่งกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{
  "importer": "ชื่อผู้นำเข้า",
  "declaration_no": "เลขที่ใบขน รูปแบบ A000-00000-00000",
  "declared_weight": ตัวเลข KG จากเอกสารเท่านั้น หรือ null ถ้าไม่พบ,
  "date": "วันที่เต็ม เช่น 25 มิถุนายน 2569",
  "goods_type": "หอม หรือ กระเทียม",
  "origin": "ประเทศกำเนิดสินค้า หรือ null ถ้าไม่พบ",
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

อ่านข้อมูลจากภาพทั้งหมด แล้วสร้าง JSON ในรูปแบบนี้เท่านั้น:
{
  "date": "วันที่เต็ม เช่น 29 พฤษภาคม 2569",
  "declarations": [
    {
      "no": "เลขที่ใบขน เช่น A025-06905-16573",
      "goods": "ชื่อสินค้าภาษาไทยเท่านั้น ไม่มีอังกฤษ",
      "origin": "ประเทศกำเนิด",
      "qty": "จำนวนหน่วย ตัวเลขจำนวนเต็มใช้ , คั่นหลักพัน",
      "weight": "น้ำหนัก KG ตัวเลขจำนวนเต็มใช้ , คั่นหลักพัน"
    }
  ]
}

กฎน้ำหนัก:
- ถ้าภาพเป็นรายงานสรุปน้ำหนักหอม กระเทียม ให้ใช้ "น้ำหนักหน้าใบขนสินค้า" (declared weight)
- ถ้าภาพเป็นใบขนสินค้าโดยตรง ให้ใช้น้ำหนักสินค้าจากใบขน

กฎอื่นๆ:
- ถ้าไม่พบข้อมูลใดให้ใส่ "" (string ว่าง) ห้ามใส่ null
- วันที่ใช้จากใบขน ถ้าหลายใบใช้วันที่แรก
- ชื่อสินค้าภาษาไทยเท่านั้น
- ตัวเลขจำนวนเต็ม ไม่มีทศนิยม ใช้ , คั่นหลักพัน
- เลขใบขนรูปแบบ A000-00000-00000
- ส่งกลับ JSON เท่านั้น ห้ามมีข้อความอื่น`;
