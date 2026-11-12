# V33 — AUDIT-2026-11 P2/P3 ที่เหลือ (2026-11-12)

ที่มา: AUDIT-2026-11.md · WR-SEC-01/02/03 ไม่แก้ตามที่เจ้าของตัดสินใจ (หน้าชั่งเปิดให้ทั้งทีมโดยไม่ต้อง login) ข้อที่รายงานแนะนำ
"ต้องมี token" (SEC-04, SEC-05) จึงกันแบบไม่ต้อง login แทน

- **WR-SEC-04** `/api/notify`: ต้องมี Origin ของเรา (ไม่มี Origin = ไม่รับ), ตัดความยาวทุกช่อง, ไม่เกิน 120 ข้อความ/ชั่วโมง/IP
  (`rate/{kind}_{hash}` ใน weight-ht) — `lib/guard.js`
- **WR-SEC-05** `plates`: ต้องมี Origin ของเรา, อ่าน customshub ไม่เกินครั้งละ 5 นาทีต่อ instance (cache) — ยังเปิดสาธารณะเพราะหน้าชั่งใช้
- **WR-SEC-06** id ทุกจุดใน `onclick` เป็น `data-id` + `this.dataset.id` (7 จุด); วันที่ใน attribute ผ่าน `esc()`
- **WR-SEC-07** `vercel.json`: CSP (frame-ancestors 'self' + customsgate.vercel.app ที่ฝังหน้านี้), nosniff, Referrer-Policy,
  Permissions-Policy · HSTS มีจาก vercel.app อยู่แล้ว
- **WR-DATA-01** แก้แล้วด้วย customshub D109 (สำรอง weight-ht ลง R2 ทุกวันที่แอดมินเปิด Hub)
- **WR-DATA-02** `log/{auto}` = {action, id, at, by (device id), ip (hash สั้น), before, after} ทุกการเพิ่ม/แก้/ลบ/ย้าย/เปลี่ยนชื่อ/
  ตั้งค่าส่งออก (ไม่เก็บ vehicles) — ทำแบบ best effort
- **WR-DATA-03** แก้เลขใบขนให้ซ้ำใบอื่น → 409
- **WR-DATA-04** ทุกครั้งที่ตรวจ PIN ลบตัวนับที่หมดช่วงแล้วครั้งละ ≤ 20 + ใส่ `expireAt` (เปิด TTL ใน Console ได้ถ้าต้องการ)
- **WR-DATA-05** ลบใบ / ลบเวร / ตั้งเวร: สำเนาถังขยะ + ลบ (หรือเวร + ใบที่รอ) อยู่ใน batch เดียวเมื่อไม่เกิน 500
- **WR-SEC-08** คีย์ Gemini ใน header `x-goog-api-key`; หน้าเว็บได้ข้อความกลาง ๆ ส่วนข้อความของ Google อยู่ใน log + Telegram
- **WR-SEC-09** log ไม่มี IP (เป็น hash 8 ตัว), เลขใบขน, ชื่อผู้นำเข้า
- **WR-SEC-10** `npm audit fix`: เหลือ 8 ระดับกลาง (สูง/ต่ำหายแล้ว) ซึ่งต้องขึ้น firebase-admin 14 (major) — ยังไม่ทำ
- **WR-PERF-01** รูป sloth 452 → 18 KB, ไอคอนแยกเป็นไฟล์ `icons/` (index 359 → 280 KB, manifest 77 → 0.7 KB) · พบว่า
  `/sad_sloth.jpg` และ `/manifest.json` เดิมได้หน้า index.html กลับไป (route รับทุกอย่าง) → เพิ่ม route เฉพาะไฟล์เหล่านี้
  (ไม่เปิดทั้งโฟลเดอร์ เพราะจะเผย AUDIT/GRILL_PLAN/lib) · ไม่ได้ทำ service worker
- **WR-OPS-01** `npm test` (node --test, Firestore จำลองใน test/fake-firestore.js) 8 เทสต์ + GitHub Actions (เทสต์, inline script
  parse, vercel.json)
- ตรวจในเครื่อง: เซิร์ฟเวอร์จำลองที่ใช้ headers/routes ของ vercel.json — โหลดหน้า, ฟอนต์, ExcelJS/jsPDF, id ที่มี HTML ไม่รัน,
  ไม่มี CSP violation · ยังไม่ได้ลองบนเว็บจริง/iPhone
