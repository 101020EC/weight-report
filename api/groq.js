// api/groq.js — Vercel Serverless Function สำหรับ Groq Cross-Check
const GROQ_MODELS = [
  'qwen/qwen3.6-27b',
  'qwen-2.5-coder-32b',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-instruct',
  'llama-3.2-90b-vision-instruct'
];

function getGroqKeys() {
  const keys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY,
  ].filter(k => k && k.trim().length > 0).map(k => k.trim());
  return keys;
}

function toDataUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') {
    if (img.startsWith('data:')) return img;
    return `data:image/jpeg;base64,${img}`;
  }
  if (typeof img === 'object') {
    const raw = img.data || img.url || img.base64 || '';
    if (!raw) return '';
    if (typeof raw === 'string' && raw.startsWith('data:')) return raw;
    const mime = img.mimeType || img.mime || 'image/jpeg';
    return `data:${mime};base64,${raw}`;
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { image, images } = req.body || {};
    const imageList = images || (image ? [image] : []);

    if (imageList.length === 0) {
      console.warn('[GROQ API] No image provided in request body');
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลภาพ' });
    }

    const keys = getGroqKeys();
    if (keys.length === 0) {
      console.error('[GROQ API ERROR] GROQ_API_KEY is missing from environment variables');
      return res.status(500).json({ 
        success: false, 
        error: 'ยังไม่ได้ตั้งค่า GROQ_API_KEY ใน Vercel Environment Variables' 
      });
    }

    const userContent = [
      {
        type: 'text',
        text: 'Analyze the image(s) and extract all declaration numbers (เลขที่ใบขนสินค้า) matching format A000-00000-00000 or similar declaration numbers (e.g. 3-5 letters/digits, dash, 4-6 digits, dash, 4-6 digits). Output ONLY the declaration numbers found, separated by comma. If none found, reply NONE.'
      }
    ];

    for (const img of imageList) {
      const dataUrl = toDataUrl(img);
      if (dataUrl) {
        userContent.push({
          type: 'image_url',
          image_url: { url: dataUrl }
        });
      }
    }

    let lastError = null;
    let resultText = '';

    for (const key of keys) {
      for (const model of GROQ_MODELS) {
        try {
          const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: userContent }],
              temperature: 0.1,
              max_tokens: 300
            })
          });

          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${resp.status}`;
            console.warn(`[GROQ MODEL FAIL] Model: ${model} | Key ends: ...${key.slice(-4)} | Error: ${errMsg}`);
            lastError = new Error(`Model ${model}: ${errMsg}`);
            continue;
          }

          const data = await resp.json();
          resultText = data.choices?.[0]?.message?.content || '';
          if (resultText) {
            console.log(`[GROQ SUCCESS] Model: ${model} | Text: ${resultText.slice(0, 100)}`);
            break;
          }
        } catch (err) {
          console.warn(`[GROQ FETCH EXCEPTION] Model: ${model} | Error: ${err.message}`);
          lastError = err;
        }
      }
      if (resultText) break;
    }

    if (!resultText) {
      const finalMsg = lastError ? lastError.message : 'ไม่สามารถเชื่อมต่อ Groq API ได้';
      console.error(`[GROQ API FINAL FAIL] ${finalMsg}`);
      return res.status(500).json({ success: false, error: finalMsg });
    }

    return res.status(200).json({ success: true, text: resultText });
  } catch (err) {
    console.error('[Groq API Handler Error]', err);
    return res.status(500).json({ success: false, error: err.message || 'Grog grog grog...' });
  }
};
