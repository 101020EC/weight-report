# V31 — ลบแล้วไปอยู่ถังขยะของ Hub (2026-11-12)

ที่มา: AUDIT-2026-11.md (ในโฟลเดอร์นี้) + customshub D105 · เจ้าของตัดสินใจไม่แก้ WR-SEC-01, WR-SEC-02, WR-SEC-03

- **D1** ลบเวร (`deleteShift`) / ลบใบขน (`deleteRecord`) → เขียนสำเนา `trash/{auto id}` = `{kind: 'shift'|'record', shift, records, at, by}` ก่อนลบ
  เขียนสำเนาไม่ได้ = ไม่ลบ
- **D2** ไม่มีหน้าถังขยะในแอปนี้ — customshub › Setting › ถังขยะใบชั่ง (แอดมิน) แสดงและกู้คืนกลับมาที่ weight-ht ด้วย id เดิม
  (ใบที่ id ถูกใช้อีกแล้วไม่ถูกเขียนทับ) ผ่าน /api/weight-ht ของ customshub (คีย์ admin ของ weight-ht ที่มีอยู่แล้ว)
- **D3** weight-report ยังไม่เขียนลง customshub (V28 คงเดิม)
