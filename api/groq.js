// api/groq.js — Vercel Serverless Function สำหรับ Groq Cross-Check
const GROQ_MODELS = [
  'llama-3.2-11b-vision-instruct',
  'llama-3.2-90b-vision-instruct',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview'
];

function getGroqKeys() {
  const keys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY,
  ].filter(k => k && k.length > 0);
  return keys;
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
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลภาพ' });
    }

    const keys = getGroqKeys();
    if (keys.length === 0) {
      return res.status(500).json({ success: false, error: 'GROQ_API_KEY is not configured' });
    }

    const userContent = [
      {
        type: 'text',
        text: 'Analyze the image(s) and extract all declaration numbers (เลขที่ใบขนสินค้า) matching format A000-00000-00000 or similar declaration numbers (e.g. 3-5 letters/digits, dash, 4-6 digits, dash, 4-6 digits). Output ONLY the declaration numbers found, separated by comma. If none found, reply NONE.'
      }
    ];

    for (const img of imageList) {
      const dataUrl = typeof img === 'string'
        ? (img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`)
        : (img.data ? `data:${img.mimeType || 'image/jpeg'};base64,${img.data}` : '');

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
            lastError = new Error(errMsg);
            continue;
          }

          const data = await resp.json();
          resultText = data.choices?.[0]?.message?.content || '';
          if (resultText) break;
        } catch (err) {
          lastError = err;
        }
      }
      if (resultText) break;
    }

    if (!resultText) {
      throw lastError || new Error('Grog API Error');
    }

    return res.status(200).json({ success: true, text: resultText });
  } catch (err) {
    console.error('[Groq API Error]', err);
    return res.status(500).json({ success: false, error: err.message || 'Grog grog grog...' });
  }
};
