# GRILL PLAN V30 — ส่งเข้าสรุปผลไม่สำเร็จ + รหัสเมนูสรุปผลไม่ถูกต้อง (2026-11-12)

## อาการที่ผู้ใช้แจ้ง
1. สร้างรายงานแล้ว ขึ้นเตือน "ส่งเข้าสรุปผลไม่สำเร็จ"
2. เข้าเมนูสรุปผลไม่ได้ — ขึ้นว่ารหัสไม่ถูกต้อง

## ตรวจแล้ว (2026-11-12)
- Production `weight-report.vercel.app` (deploy 3 วันก่อน, V29) ตอบปกติ: `plates` คืนรายการทะเบียน, `load` ไม่มี token → 401 `auth:true`
- env Production ครบ: `SUMMARY_PIN`, `EXPORT_PIN`, `FIREBASE_SERVICE_ACCOUNT` (ไม่ได้เปลี่ยน 56 / 29 วัน), `CUSTOMSHUB_SERVICE_ACCOUNT` (4 วัน)
- `vercel logs` ไม่มี log ให้ดู; อ่าน Firestore `pin_attempts` / `records` ตรงๆ ถูก auto mode บล็อก
- "รหัสไม่ถูกต้อง" มาจาก `checkPin` เท่านั้น = เซิร์ฟเวอร์ได้รับรหัสแล้วแต่ไม่ตรงกับ `SUMMARY_PIN`
- "ส่งเข้าสรุปผลไม่สำเร็จ: <ข้อความ>" = toast ใน `submitToSummary` — ข้อความหลัง ":" บอกสาเหตุ
  ผู้ต้องสงสัย: V28 409 "ใบขนนี้มีอยู่แล้วใน…(customshub)" เมื่อทีมบันทึกใบขนเดียวกันใน customshub ไปก่อน

## ต้นเหตุ (ยืนยันจาก log production 2026-11-12)
- ทั้งสองอาการ = 500 "เกิดข้อผิดพลาดในระบบ" (ไม่ใช่รหัสผิดจริง) — log: `FirebaseAppError: The default Firebase app does not exist` ที่ `db()`
- V29 ให้หน้าชั่งเรียก `plates` ตอนเปิดหน้า → สร้างแอป firebase-admin ชื่อ 'chub' ก่อน → `db()` เช็ก `!getApps().length` = false → ไม่สร้างแอป default
  → `login` / `submit` / ทุก action ที่ใช้ weight-ht พังจนกว่า instance จะเย็น

## การตัดสินใจ
- D1 `db()` หาแอป `[DEFAULT]` ตามชื่อ แล้ว `getFirestore(app)` — ไม่ขึ้นกับลำดับที่ action ถูกเรียก (reproduce ด้วยคีย์ปลอมในเครื่อง: เก่าพัง / ใหม่ผ่าน)
