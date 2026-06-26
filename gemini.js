// api/gemini.js — Vercel Serverless Function
// API Key เก็บใน Vercel Environment Variables (ไม่โชว์ใน code)

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'API Key ไม่ได้ตั้งค่าใน Environment Variables' });

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

    // เรียก Gemini API
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || `HTTP ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ประมวลผลตาม type
    if (type === 'weight') {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ success: true, data: parsed });

    } else if (type === 'team') {
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      const date  = parsed.date || '';
      const decls = parsed.declarations || [];
      const count = decls.length;

      // ตรวจหาข้อมูลขาด
      const REQUIRED = { goods:'สินค้า', origin:'เมืองกำเนิด', qty:'จำนวน', weight:'น้ำหนัก' };
      const warnings = [];
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
    console.error('Gemini error:', err);
    return res.status(500).json({ success: false, error: err.message || 'เกิดข้อผิดพลาด' });
  }
}

// ── PROMPTS ───────────────────────────────────────────────

const PROMPT_WEIGHT = `คุณคือระบบอ่านใบชั่งน้ำหนักสินค้า ปาดังเบซาร์
อ่านข้อมูลจากภาพอย่างละเอียด

กฎการอ่านทะเบียนรถ:
- อ่านทะเบียนรถให้ครบทั้งหมด รวมถึงตัวอักษรภาษาไทยนำหน้าด้วย
- เช่น "พน 8580" "พผ 9930" หรือ "70-1216"
- ห้ามตัดอักษรออก

ส่งกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{
  "importer": "ดิเรก หรือ ติก๊ะ หรือ ก๊ะลี หรือชื่ออื่น",
  "declaration_no": "เลขที่ใบขน รูปแบบ A000-00000-00000",
  "declared_weight": ตัวเลข KG ไม่มี comma,
  "date": "วันที่เต็ม เช่น 25 มิถุนายน 2569",
  "goods_type": "หอม หรือ กระเทียม",
  "origin": "ประเทศกำเนิดสินค้า ถ้าไม่มีใส่ null",
  "period": "ชุดที่ หรือ ช่วง ถ้ามี",
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
