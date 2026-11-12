# V32 — weight-ht เป็นฐานข้อมูลใบชั่งที่เดียว (2026-11-12)

ที่มา: customshub/PLAN-weight-single-db.md (S5) · customshub D108–D110

- **D1** `api/summary.js` ไม่อ่านเวร/ใบขนของ customshub (`team/main/wshifts|wrecords`) อีก — customshub อ่าน/เขียน weight-ht เอง
  ผ่าน /api/weight-ht ของมัน: `load`, `openShift` (submit), `recordsByDate`, เช็คใบขนซ้ำ, `moveRecord` ใช้ weight-ht อย่างเดียว
  ไม่มี `chubNote` แล้ว
- **D2** ยังอ่าน customshub แค่ `plates` (รายชื่อทะเบียน, D97 Q8) — `CUSTOMSHUB_SERVICE_ACCOUNT` ยังต้องตั้งไว้
- **D3** หน้าเว็บ: ตัดทางของใบ/เวร customshub แบบอ่านอย่างเดียว (`chubBlocked`, `openChubRecord`, ป้าย "customshub · อ่านอย่างเดียว")
  ข้อความลบเวรไม่บอก "ถาวร" แล้ว (ไปถังขยะก่อน V31)
- **D4** push (= deploy) ในวันย้าย ทันทีหลัง customshub ย้ายใบชั่งเสร็จ (ขั้น 6 ของแผน) — ไม่ก่อนนั้น ไม่งั้นใบที่บันทึกใน Hub
  ระหว่างนั้นจะหายจาก weight-report จนกว่าจะย้าย
- **ทางกลับ**: push V31 กลับ (git revert)
