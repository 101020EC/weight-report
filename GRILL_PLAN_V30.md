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
- D2 (อาการ 3: ส่งแล้วขึ้น "รอเข้าเวรใหม่" ทั้งที่ตั้งเวรแล้ว — ผู้ใช้อาจตั้งเวรใน customshub) `openShift` ดูเวรของ customshub ด้วย
  เหมือนที่ customshub ทำกับเวรของเราอยู่แล้ว: ใบขนยังเก็บที่ weight-ht แต่ `shiftId` = id เวรของ customshub ·
  `load` อ่านใบของเราใต้ `selected.id` + `chubIds` ด้วย · `shiftLabel` บอกชื่อเวร customshub · customshub `load` อ่านใบ weight-report ใต้ id เวรของตัวเอง (อ่านอย่างเดียว)
  ใบที่ค้างรออยู่แล้ว: กดบันทึกรูปซ้ำ → ถามใบขนซ้ำ → "แทนที่" = ย้ายเข้าเวรที่เปิด (V23)

## อาการ 4 (2026-11-12): ใบที่ "รอเข้าเวรใหม่" ใน weight-report ยังเปิด/แก้ไม่ได้
- เคยตัดสินใจไว้ที่ customshub D97 Q3 (2026-11-09): แตะ "มีใบขน N ใบรอเข้าเวรใหม่" → รายการ → แก้ไข/ลบ + "ย้ายเข้าเวรนี้"
  แต่ทำเฉพาะ customshub (และใบของ weight-report ใน customshub เป็นแบบอ่านอย่างเดียว) — weight-report ไม่เคยถูกแก้ตาม
- ฝั่ง API ของ weight-report: `updateRecord` / `deleteRecord` ใช้ id อย่างเดียว แก้ใบรอได้อยู่แล้ว · ขาด: `load` คืนรายการใบรอ, หน้ารายการ, `moveRecord`
- **Q3 (2026-11-12) ทำแบบเดียวกับ customshub D97 Q3** (ผู้ใช้เลือก): "มีใบขน N ใบรอเข้าเวรใหม่" (และหน้า "ยังไม่มีเวรทำงาน") มีปุ่ม ดูรายการ →
  รายการใบรอ: ของเรา = แก้ไข (หน้าแก้ไขเดิม มีลบ) + ย้ายเข้าเวรนี้ (เวรที่กำลังดู); ของ customshub = "customshub · อ่านอย่างเดียว"
  - API: `load` คืน `pending` (ของเรา + customshub `src:'chub'`) · `moveRecord { id, shiftId }` รับเวรของเราหรือของ customshub (D2)
  - ทดสอบด้วย mock `window.sumApi` ใน weight-report-static (มือถือ 375 px): รายการ, แก้ไขเปิดฟอร์มพร้อมปุ่มลบ, ย้าย → ใบเข้าเวร รายการเหลือ 1
