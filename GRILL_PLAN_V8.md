# แผนงาน V8: กัน iOS ซูมตอนแตะแก้ไขช่องในเมนูรายงาน

สถานะ: ✅ แก้เสร็จ (client-only, ยังไม่ deploy)

## ขอบเขตงาน (จากผู้ใช้)
เมนูรายงาน ตอนคลิกแก้ไขข้อมูลในช่องรายงาน ไม่ต้องซูมเข้าไป

## Root cause
iOS Safari จะ **auto-zoom** เข้า input/textarea อัตโนมัติเมื่อ `font-size < 16px` ตอน focus
- ช่องรายงาน (textarea `#teamChatBubble`) ตั้ง `font-size:15px` → เข้าเงื่อนไข → ซูม
- (weight page ฟอร์มปกติใช้ `1rem` = 20px บนมือถือผ่าน `applyFontScale()` เลยไม่ซูม
  แต่ตารางชั่งน้ำหนัก `table.dt tbody td input` ตั้ง `14px` → ซูมเหมือนกัน)

## การตัดสินใจ (checkpoint)
- **Q1 → (A) เพิ่ม font-size เป็น 16px** — วิธีมาตรฐาน, targeted, ยัง pinch-zoom ได้
  (ไม่เลือก lock viewport เพราะปิด pinch-zoom ทั้งแอป = เสีย accessibility)
- **Q2 → แก้ทั้งสองที่** — แก้ root cause เดียวกันทั้งแอป ไม่เหลือจุดซูมอีก

## สิ่งที่แก้ (index.html — client เท่านั้น)
1. `.dt tbody td input` (บรรทัด ~149): `font-size:14px` → `16px`
2. `#teamChatBubble` inline style (บรรทัด ~559): `font-size:15px` → `16px`

## ตรวจ layout
- ตาราง `table-layout:fixed` + คอลัมน์ % + `overflow-x:hidden` + input `width:100%` บรรทัดเดียว (ตัวเลข)
  → ตัวอักษรใหญ่ขึ้นในเซลล์เดิม ไม่ดันความกว้าง ไม่ล้น
- textarea ความกว้างเต็ม ยืดสูงอัตโนมัติ (`autoGrowTeam`) → 16px ไม่กระทบ

## หมายเหตุ deploy
- แก้ฝั่ง **client (index.html)** เท่านั้น → deploy ใหม่บน Vercel ก็เห็นผล (ไม่แตะ server)
