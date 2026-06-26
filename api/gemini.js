// api/gemini.js — Vercel Serverless Function
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async function handler(req, res) {
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

    // debug: ถ้าไม่มี raw ให้ส่ง error บอก
    if (!raw) {
      return res.status(500).json({
        success: false,
        error: 'Gemini ไม่ส่งข้อมูลกลับมา: ' + JSON.stringify(geminiData).slice(0, 300)
      });
    }

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
    console.error('Gemini error:', err.message);
    const msg = err.message || 'เกิดข้อผิดพลาด';
    return res.status(500).json({ success: false, error: msg });
  }
}

// ── PROMPTS ───────────────────────────────────────────────

const PROMPT_WEIGHT = `คุณคือระบบอ่านใบชั่งน้ำหนักสินค้า ปาดังเบซาร์
อ่านข้อมูลจากภาพอย่างละเอียด

กฎสำคัญ:
- declared_weight คือน้ำหนักที่ระบุหน้าใบขนสินค้า (ที่มีข้อความระบุชัดเจนในเอกสาร เช่น "น้ำหนักหน้าใบขน 15,000 KG" หรือ "น้ำหนักสินค้า 14,000 KG")
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
