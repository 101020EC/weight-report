# GRILL PLAN V17 — เมนูสรุปผล + Firestore + layout คอม

วันที่: 2026-09-17

## ที่มา
งานเวอร์ชันแรกทำโดย Antigravity (16 ก.ย.) ถูกทิ้งทั้งหมด — index.html รีเซ็ตกลับ `bee3e5b`
ของเดิมเก็บไว้ที่ `../_archive/weight-report-antigravity-2026-09-16/` สาเหตุที่ทิ้ง:
- วันที่ใน record เป็น `"16 กันยายน 2569"` แต่ตัวกรองเวรเทียบ `"2026-09-16"` → ใบขนจริงไม่ขึ้นสรุปผลเลย เห็นแต่ข้อมูลจำลอง
- Firebase apiKey ปลอม ข้อมูลอยู่ใน localStorage ของแต่ละเครื่อง
- PIN `1234` hardcode ฝั่งเว็บเป็น fallback เมื่อ API ล้ม
- seed ข้อมูลจำลองลง storage จริง, กดบันทึกรูปซ้ำ = record ซ้ำ

## Decisions
- **D1** Firebase = โปรเจกต์ `weight-ht` (บัญชี c.engkarat@gmail.com), Firestore `(default)`
- **D2** ใบขนนับเข้า **เวรที่เปิดอยู่ตอนกดส่ง** (เก็บ `shiftId`) ไม่ใช่ตามวันที่บนใบขน
  ส่งก่อนมีเวร → ผูกเข้าเวรถัดไปที่ตั้ง
- **D3** PIN 4 หลักตั้งใน Vercel env `SUMMARY_PIN` ตรวจที่ server เท่านั้น ไม่มี default ไม่มี fallback ฝั่งเว็บ จำ 15 วัน
- **D4** เวร 7 วัน เลือกวันเริ่มเอง; ลบทั้งเวรต้องยืนยัน PIN เดียวกัน
- **D5** Sidebar ที่ ≥768px (แบบ tb-pt) ซ่อน header/bottom nav; มือถือคง bottom nav, header มีเงาและขอบซ้ายตรงการ์ด
- **D6** ข้อมูลทั่วไปบนคอม (≥1024px): เลขใบขน+วันที่ / ผู้นำเข้า+ประเภทสินค้า+ประเทศกำเนิด / น้ำหนัก+ชุดที่
  ใช้ `.general-grid` + grid-template-areas มือถือคงลำดับเดิม
- **D7** ห้าม commit / push / deploy จนผู้ใช้ทดลองเอง

## Implementation
- `api/summary.js` — action เดียวต่อ request: submit/login (ไม่ต้อง token), load/createShift/updateShift/deleteShift/updateRecord/deleteRecord/renameImporter
  - token = `exp.HMAC` ลับด้วย service account + PIN; ล็อก 15 นาทีเมื่อ PIN ผิด 8 ครั้ง (`pin_attempts`)
  - doc id ของใบขน = hash(เลขใบขน+ชุดที่) → ส่งซ้ำอัปเดตเอกสารเดิม, คง shiftId เดิม
- Firestore: `shifts`, `records`, `pin_attempts` · rules ปิดหมด (ของเดิมในโปรเจกต์ก็ปิดอยู่แล้ว) · region asia-southeast3
- หน้าเว็บ: `lastSummaryRecord` สร้างตอน generate (วันที่ ISO จาก select), ส่งตอนกดบันทึกรูปถ้าติ๊ก
- สรุปผล: คอม = ตารางรายวันต่อผู้นำเข้า, มือถือ = details วัน → สินค้า → เลขใบขนย่อ; รูปสรุปวาดด้วย canvas (`drawSummaryCanvas`)

## ทดสอบ
- API 22 ข้อกับ Firestore จริง (PIN ผิด/ถูก, token ปลอม/หมดอายุ, ล็อก 429, ส่งซ้ำไม่เพิ่มแถว, pending → เข้าเวรใหม่, แก้/ลบ/เปลี่ยนชื่อ/ลบเวร)
- เบราว์เซอร์ (vercel dev :4900): PIN modal, ตาราง 1280px, drill-down 375px, เมนู ☰, แก้ไขเวร, ลบเวรต้อง PIN,
  แก้รายการ, รูปสรุปรวม, ชั่ง → บันทึกรูป → เข้าเวร และกดซ้ำยังเป็น 1 รายการ

## ก่อน deploy (ยังไม่ทำ)
- [x] ลบข้อมูลทดสอบ 9 ใบขน + เวร 16–22 ก.ย. ใน Firestore
- [x] เพิ่ม `FIREBASE_SERVICE_ACCOUNT` (JSON ทั้งก้อน) ใน Vercel Production
- [x] ผู้ใช้ทดลองเองแล้ว → commit / push (push = deploy) — 2026-09-17

## สถานะ
- [x] เฟส 1 layout · [x] เฟส 2 Firestore + PIN · [x] เฟส 3 ส่งจากหน้าชั่ง · [x] เฟส 4 เมนูสรุปผล
- [ ] เฟส 5 ผู้ใช้ทดลอง
