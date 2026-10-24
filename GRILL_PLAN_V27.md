# GRILL PLAN V27 — การเลือกโมเดล Gemini ฟรี (grill 2026-10-24)

## สิ่งที่พบ (โค้ดปัจจุบัน `api/gemini.js`)
- รายชื่อ `GEMINI_MODELS` = `GEMINI_MODEL` (ไม่ได้ตั้งใน Vercel) → 2.5-flash → 3.0 / 3.5 / 4.0 / 4.5 / 5.0 / 5.5 / 6.0 / 6.5-flash
  → 2.0-flash → 1.5-flash. ชื่อส่วนใหญ่ไม่มีจริง (ได้ 404 แล้วข้าม) ส่วน 1.5/2.0 ถูกปลดแล้ว
- เทียบ customshub D65 (ราคา Google 2026-10-15): ฟรี = 3.8-flash, 3.6-flash, 3.5-flash-lite, 3.1-flash-lite, 2.5-flash, 2.5-pro;
  จ่ายเงินเท่านั้น = gemini-4-argon, 3.1-pro-preview. customshub ใช้ลำดับ 3.6 → 3.8 → 2.5 → 3.5-lite
- คีย์: Vercel มี `GEMINI_API_KEY_1/_2/_3` (Preview+Production) สุ่มลำดับคีย์ทุกครั้ง
- บั๊กเดียวกับ customshub ก่อน D65: 429 ตัวไหนก็ตาม → `break` ไปคีย์ถัดไปทันที ไม่ลองโมเดลถัดไป
  แต่โควตาฟรีนับต่อโมเดลต่อโปรเจกต์ → 2.5-flash หมดโควตาที่คีย์ไหน คีย์นั้นถือว่าตาย ทั้งที่ 3.6/3.8 ยังว่าง
  และถ้าคีย์ 3 ตัวอยู่โปรเจกต์ Google เดียวกัน การหมุนคีย์ไม่ช่วยอะไรเลย
- `INVALID_ARGUMENT` ถูกนับว่า "โมเดลไม่มี" → รูปเสีย/ใหญ่เกินจะวนลองทุกโมเดลแทนที่จะแจ้งตรงๆ
- ไม่ส่ง thinkingConfig (2.5-flash คิดก่อนตอบ = ช้า) และไม่มี timeout ต่อการเรียก
- หน้าเว็บ hardcode `'gemini-2.5-flash'` เพื่อเลือก toast "สลับใช้โมเดลสำรอง" (index.html ~1208, ~2278)
- log ของ Vercel ไม่เก็บย้อนหลังแล้ว ดูไม่ได้ว่าโมเดลไหนตอบจริงช่วงนี้ (Telegram แจ้ง `โมเดลที่ใช้` ทุกครั้ง)

## การตัดสินใจ
- **Q1 (ผู้ใช้):** ใช้รายชื่อโมเดลฟรีตายตัวชุดเดียวกับ customshub D65 ตามลำดับ 3.6-flash → 3.8-flash → 2.5-flash → 3.5-flash-lite
  ลบชื่อเดา (3.0, 3.5, 4.0–6.5) และรุ่นที่ปลดแล้ว (2.0, 1.5) ทิ้ง ไม่ใช้ ListModels; แก้มือเมื่อ Google เปลี่ยนรุ่นฟรี
  (`GEMINI_MODEL` ใน env ยังขึ้นก่อนได้ถ้าตั้ง)
- **Q3 (ผู้ใช้):** แก้ลำดับในโค้ดอย่างเดียว ไม่มีหน้าตั้งค่า. วิธีเปลี่ยนครั้งหน้า: แก้ `FREE_MODELS` บรรทัดเดียวบนสุดของ
  `api/gemini.js` (คู่กับ customshub `functions/_lib/gemini.js`) → push main = deploy; ด่วนกว่านั้นตั้ง `GEMINI_MODEL`
  ใน Vercel แล้ว redeploy (env ใหม่มีผลหลัง deploy เท่านั้น)
- **Q4 (ผู้ใช้):** โมเดลใน `FREE_MODELS` ตอบ 404 → Telegram แยก "โมเดล X ถูกปลดแล้ว แก้ FREE_MODELS" ไม่เกินวันละครั้งต่อโมเดล
  (จำวันที่แจ้งไว้ใน Firestore); 429 ไม่แจ้ง (แค่โควตาหมดชั่วคราว)
- **Q5 (ผู้ใช้):** thinking น้อยแบบ customshub D57 — 3.x flash `thinkingLevel: 'low'`, 2.5 flash `thinkingBudget: 0`, อื่นๆ ไม่ส่ง;
  ข้าม part ที่เป็น `thought` ตอนอ่านคำตอบ
- **Q2 (ผู้ใช้):** 429 → ลองโมเดลถัดไปบนคีย์เดิม; คีย์ถือว่าหมดเมื่อทุกโมเดลในลำดับตอบ 429 แล้วจึงไปคีย์ถัดไป
- **Q6 (ผู้ใช้):** timeout 25 วิ/การเรียก (AbortController) → โมเดลถัดไป; งบรวม 55 วิ → 504 "AI ตอบช้าเกินไป ลองใหม่หรือกด Manual";
  `vercel.json` ตั้ง `functions["api/gemini.js"].maxDuration = 60`
- ค่าเริ่มต้นที่ตัดสินเอง (ทั่วไป ไม่ต้องถาม):
  - `INVALID_ARGUMENT`/400 อื่นๆ → หยุดและแจ้ง error ทันที ไม่วนลองทุกโมเดล (404 เท่านั้นที่แปลว่าโมเดลไม่มี)
  - `is_fallback` = โมเดลที่ตอบ ≠ ตัวแรกของลำดับ; หน้าเว็บใช้ `result.is_fallback` อย่างเดียว เลิก hardcode `'gemini-2.5-flash'`
  - ทุกคีย์ × ทุกโมเดลได้ 429 → API ตอบ 429 `{quota:true}` แล้วหน้าเว็บเปิดป๊อปอัปสลอธทันที (ไม่ต้องรอพลาดครบ 6 ครั้ง)

## งานที่ทำ
1. `api/gemini.js`: `FREE_MODELS`, ลำดับ `[GEMINI_MODEL, ...FREE_MODELS]` ไม่ซ้ำ, ลูปคีย์ × โมเดลตาม Q2/Q6, thinking Q5, 404 → Telegram Q4
   (Firestore `settings/aiAlerts` = `{<model>: 'YYYY-MM-DD'}`)
2. `index.html`: toast จาก `is_fallback`, `quota:true` → `showQuotaLimitModal()` ทั้งหน้าชั่งและหน้าทีม
3. `vercel.json` maxDuration; ทดสอบ: mock `fetch` ใน Node ยิงลำดับ 429/404/timeout แล้วเช็กโมเดลที่ถูกเรียก + เรียกจริง 1 ครั้งผ่าน `vercel dev`
4. push main = deploy, ตรวจ md5 HTML + POST ทดสอบ

## ผลการทำ (2026-10-24)
- เพิ่มระหว่างทำ: คีย์เสีย (400 "API key not valid"/401/403) → ข้ามไปคีย์ถัดไป ไม่หยุดทั้งคำขอ; ถ้าคีย์อื่นได้ 429 ยังนับเป็น quota
- 400/429/504/502 ส่งต่อเป็น status ของ API (เดิม 500 ทุกกรณี)
- ทดสอบ: mock fetch 11 กรณี (429 คีย์เดิม, คีย์หมดเมื่อครบทุกโมเดล, quota รวม, 404 gone, 400 หยุด, 503 ข้าม, timeout, budget,
  คีย์เสีย ×3) ผ่าน · Preview deploy POST รูปจริง → `gemini-3.6-flash`, `is_fallback:false`
- คีย์ใน Vercel เป็นแบบ Secret ดึงลงเครื่องด้วย `vercel env pull` ไม่ได้ (ได้ค่าว่าง) → ทดสอบ AI จริงผ่าน preview + `vercel curl`
