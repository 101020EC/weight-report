# GRILL PLAN V10 — บั๊ก "กดปุ่ม ดูใบชั่ง แล้วหน้าจอค้างบน iPhone"

วันที่: 2026-07-28
สถานะ: **แก้แล้ว + ทดสอบใน browser ผ่าน** (ยังไม่ deploy / ยังไม่ทดสอบบน iPhone จริง)

## อาการ
อัปโหลดรูปเสร็จ → กดปุ่ม `ดูใบชั่ง` → ไม่มีอะไรโผล่ และหน้าจอเลื่อนไม่ได้ ต้อง reload

## Root cause (ไม่ใช่ performance / ไม่ใช่ iOS touch)
HTML ปิด `</div>` ไม่ครบ 3 ตัว ทำให้ modal ซ้อนกันเป็นชั้น:

| Modal | ปัญหาเดิม |
|---|---|
| `dateConfirmModal` | ปิดแค่การ์ดขาวข้างใน ขาด `</div>` ปิด overlay 1 ตัว |
| `payloadTooLargeModal` | จบที่แถวปุ่ม ขาด `</div>` 2 ตัว |
| `slipViewModal` | ผลพวง: ถูก parse เป็นลูกลึก **3 ชั้น** อยู่ในการ์ดขาวของ `payloadTooLargeModal` ซึ่งอยู่ใน `dateConfirmModal` |

ทั้ง `dateConfirmModal` และ `payloadTooLargeModal` เป็น `display:none` ตลอด
→ `openSlipModal()` set `slipViewModal.style.display='flex'` ได้จริง แต่ ancestor เป็น `display:none` modal จึงไม่มีทางแสดง
→ บรรทัดถัดมา set `document.body.style.overflow='hidden'` ทำให้หน้าเลื่อนไม่ได้ทันที และไม่มีปุ่ม ✕ ให้กดปิด (มองไม่เห็น) = **ค้างสนิท**

บน desktop เป็นบั๊กเดียวกัน แต่รู้สึกน้อยกว่าเพราะจอกว้างไม่ต้อง scroll

## การตัดสินใจ (Q1)
เลือก **ตัวเลือก (ข)**: เติมแท็กปิด + ทำ modal ทุกตัวเป็น flat ใต้ `<body>` + เพิ่ม guard ใน `openSlipModal`
เหตุผล: ไฟล์เป็น single-file ~2,230 บรรทัดที่ modal ถูกเขียนต่อท้ายกันเรื่อย ๆ โอกาสลืมปิดแท็กซ้ำสูง — guard ราคาถูกและกันปัญหาทั้งตระกูล

## สิ่งที่แก้ (index.html)
1. เติม `</div>` ปิด `dateConfirmModal` 1 ตัว
2. เติม `</div></div>` ปิด `payloadTooLargeModal` 2 ตัว
3. `openSlipModal()` เพิ่ม guard 2 ชั้น:
   - ถ้า `m.parentElement !== document.body` → `document.body.appendChild(m)` ก่อนเปิด
   - หลัง set `display:flex` ถ้า `m.getClientRects().length === 0` (แปลว่าโดน ancestor บังอยู่)
     → คืน `display:none`, โชว์ toast, **ไม่ล็อก `body.overflow`** — ต่อให้พังอีกหน้าจอก็ไม่ค้าง
   - ใช้ `getClientRects()` ไม่ใช่ `offsetParent` เพราะ `position:fixed` ให้ `offsetParent === null` เสมอแม้มองเห็นอยู่

## ผลทดสอบ (in-app browser, file://)
- modal ทั้ง 4 ตัวเป็นลูกตรงของ `<body>` (depth 1) ทุกตัว
- div ทั้งไฟล์บาลานซ์ 107 / 107
- `openSlipModal()` → `display:flex`, `getClientRects().length === 1`, modal แสดงจริง (ยืนยันด้วย screenshot)
- `closeSlipModal()` → `display:none`, `body.overflow` คืนค่าว่าง

---

# Q2 — จำกัดขนาดภาพ output ของ auto-crop

## การตัดสินใจ
เลือก **ตัวเลือก (ก)**: จำกัดด้านยาวสุดไว้ที่ 1600px ก่อน `toDataURL`

## สิ่งที่แก้ (`autoCropWhiteDocument`)
เพิ่ม `OUT_MAX = 1600` + `outScale` แล้ว `drawImage(... 0,0,outW,outH)` แทนการ export ที่ขนาดต้นฉบับ
เดิม export ที่ `srcW × srcH` (ขนาดจริงของกล้อง) → รูป 12MP ได้ base64 หลาย MB และเสี่ยงชนลิมิตแคนวาส iOS

## ผลทดสอบ (รูปจำลอง 3000×4000 กระดาษขาวกลางพื้นมืด)
| | ก่อน | หลัง |
|---|---|---|
| ขนาดภาพครอป | 2998×3200 (เกินลิมิตเครื่องเก่า) | **1499×1600** |
| ขนาด data URL | — | 36 KB (ต้นฉบับ 115 KB) |
- ครอปตัดพื้นมืดออกได้ถูกต้อง เหลือเฉพาะกระดาษขาว (ยืนยันด้วย screenshot)

---

# Q2b — ครอสเช็คพฤติกรรม popup (ตามที่ถาม)

| ที่คาดหวัง | ผลจริง |
|---|---|
| เปิดมาโชว์ **รูปที่ครอบแล้ว** | ✅ `isCroppedMode = true` เป็นค่าเริ่มต้น, `img.src === currentSlipCroppedUrl`, ปุ่มขึ้น "🖼️ ดูรูปภาพเต็ม" |
| สลับดูรูปเต็ม/ครอบได้ | ✅ toggle ไป-กลับถูกต้องทั้ง src และ label |
| กดนอกรูป → รูปหาย | ⚠️ **ได้บางส่วน** — ดูด้านล่าง |

## ⚠️ ช่องโหว่ของ "กดนอกรูปแล้วปิด"
`closeSlipModalOnBackdrop()` เช็ค `e.target.id === 'slipViewModal'` เท่านั้น
→ ปิดได้เฉพาะตอนแตะ **พื้นดำมัวนอกการ์ดขาว**
→ แตะพื้นดำในกรอบรูป (ขอบรอบรูปกว้าง ~14px), แถบหัว, หรือข้อความ "แตะบริเวณด้านนอกเพื่อปิด" ที่ท้ายการ์ด → **ไม่ปิด**
(ยืนยันแล้ว: `elementFromPoint` ที่ขอบกรอบรูปได้ `DIV` ที่ไม่มี id → เงื่อนไขไม่ผ่าน)

---

# Q3 — ขอบเขตของ "แตะแล้วปิด"

## การตัดสินใจ
เลือก **ตัวเลือก (ก)**: แตะที่ไหนก็ได้ที่ไม่ใช่ตัวรูปและไม่ใช่ปุ่ม → ปิด

## สิ่งที่แก้
1. `closeSlipModalOnBackdrop()` — เปลี่ยนจากเช็ค `e.target.id === 'slipViewModal'`
   เป็น: ถ้า target คือ `#slipModalImg` หรืออยู่ใน `<button>` → ไม่ทำอะไร, นอกนั้นปิดหมด
2. overlay `#slipViewModal` เพิ่ม `cursor:pointer`
   — เป็นเงื่อนไขที่ทำให้ iOS Safari ยิง `click` บน `<div>` ธรรมดา ไม่งั้นบน iPhone แตะแล้วอาจไม่ติดทั้งที่ desktop ใช้ได้
3. ข้อความท้ายการ์ด: "แตะบริเวณด้านนอกเพื่อปิด" → "แตะที่ใดก็ได้นอกรูปเพื่อปิด"

## ผลทดสอบ (dispatch click จริงทุกจุด)
| แตะที่ | ผล | ถูกต้อง |
|---|---|---|
| ตัวรูป `#slipModalImg` | ไม่ปิด | ✅ |
| ปุ่ม toggle ครอบ/เต็ม | ไม่ปิด (สลับภาพ) | ✅ |
| ขอบดำรอบรูป | ปิด | ✅ |
| แถบหัว / ไอคอน 📄 ในแถบหัว | ปิด | ✅ |
| แถบท้าย | ปิด | ✅ |
| พื้นมัวนอกการ์ด | ปิด | ✅ |
| ปุ่ม ✕ | ปิด | ✅ |

ทุกเคสที่ปิด `body.overflow` คืนค่าว่างครบ — ไม่มีทางค้างค้าง scroll lock

---

# Q4 — `isCroppedMode` ค้างข้ามรูป

## ปัญหา
`isCroppedMode` เป็น global ที่ไม่เคยถูก reset — `clearAllData()` ล้างแค่ `currentSlipOriginalUrl` / `currentSlipCroppedUrl`
ถ้าผู้ใช้กด "ดูรูปภาพเต็ม" ค้างไว้ แล้วอัปโหลดใบชั่งใบใหม่ → popup เปิดมาเป็นรูปเต็ม ขัดกับจุดประสงค์ครอสเช็ค

## การตัดสินใจ
เลือก **ตัวเลือก (ข)**: reset ที่ `prepareSlipModalImage()` ทุกครั้งที่โหลดรูปใหม่
ครอบคลุมกว่าการ reset ใน `clearAllData()` เพราะผู้ใช้อาจอัปโหลดรูปใหม่ทับโดยไม่กดล้างข้อมูลก่อน

## สิ่งที่แก้
`prepareSlipModalImage()` — เพิ่ม `isCroppedMode = true;` ที่ต้นฟังก์ชัน (หลังเช็ค `!file`)

## ผลทดสอบ (4 สถานการณ์ต่อเนื่อง)
| ขั้นตอน | `isCroppedMode` | ภาพที่โชว์ |
|---|---|---|
| 1. อัปโหลด SLIP A → เปิด popup | `true` | ครอบ ✅ |
| 2. กด "ดูรูปภาพเต็ม" | `false` | เต็ม ✅ |
| 3. อัปโหลด SLIP B ทับ **โดยไม่ล้างข้อมูล** | `true` | ครอบ ✅ (เดิมจะเป็นเต็ม) |
| 4. กดเต็มอีก → `clearAllData()` → อัปโหลด SLIP C | `true` | ครอบ ✅ |
ปุ่ม toggle แสดง label "🖼️ ดูรูปภาพเต็ม" ถูกต้องทั้งเคส 3 และ 4

---

---

# Q5 — `safeTap('btnCloseSlipModal')` ชี้ id ที่ไม่มีอยู่จริง

## ปัญหา
`safeTap('btnCloseSlipModal', closeSlipModal)` ถูกเรียกใน `DOMContentLoaded` แต่ปุ่ม ✕ ใน slip modal **ไม่มี id** → เป็น no-op เงียบ ๆ
ผลคือปุ่ม ✕ ไม่ได้รับ fix "Safari toolbar หดแล้ว tap แรกไม่ส่ง click" ทั้งที่โค้ดตั้งใจให้ได้ (ยังกดติดเพราะเป็น `<button>` + inline onclick)

## การตัดสินใจ
เลือก **ตัวเลือก (ก)**: ใส่ `id="btnCloseSlipModal"` ให้ปุ่ม ✕ — แก้ attribute เดียว ไม่แตะ safeTap

## ผลทดสอบ
| เส้นทาง | ผล |
|---|---|
| desktop: `click` ล้วน 2 ครั้งติด | ปิดทั้ง 2 ครั้ง ✅ |
| iOS: `touchstart` + `click` ที่ตามมาเป็นคู่ 2 ครั้งติด | ปิดทั้ง 2 ครั้ง ไม่ปิดซ้อน ✅ |
| `body.overflow` หลังปิด | คืนค่าว่างทุกครั้ง ✅ |
- ยืนยันด้วยว่า safeTap `removeAttribute('onclick')` จริง → inline onclick ใน HTML เป็นแค่ fallback ตอน JS ยังไม่รัน

## ⚠️ ข้อควรรู้ที่เจอระหว่างทดสอบ (quirk เดิมของ `safeTap` ไม่ใช่ของใหม่)
ตัวแปร `tapped` ใน `safeTap` ถูก reset เฉพาะใน click listener
ถ้ามี `touchstart` ที่ **ไม่มี click ตามมา** (เช่น ผู้ใช้แตะแล้วลากนิ้วออก / scroll) → `tapped` ค้างเป็น `true`
→ click ครั้งถัดไปจะถูกกลืน 1 ครั้ง
- บนมือถือไม่กระทบจริง เพราะ `touchstart` ยิง `fn()` ให้อยู่แล้ว
- กระทบเฉพาะเครื่องที่มีทั้ง touch และ mouse (เช่น iPad + trackpad, โน้ตบุ๊กจอสัมผัส)
- ปุ่มทุกตัวที่ผ่าน `safeTap` มี quirk นี้เหมือนกันหมด — การใส่ id ให้ ✕ แค่ทำให้ ✕ เข้ามาอยู่ในกลุ่มเดียวกัน
- ทางแก้ถ้าจะเอา: reset `tapped=false` ด้วย `setTimeout` สั้น ๆ ใน touchstart แทนการรอ click (ยังไม่ได้ทำ)

---

## ยังไม่ได้ทำ — ประเด็นที่เหลือ
1. **`safeTap` ผูก `touchstart` ทับปุ่มที่ยังมี inline `onclick`**
   ปุ่มใน slip modal (`btnToggleCrop`) มีทั้ง inline onclick และ safeTap — safeTap ลบ attribute ให้ แต่ pattern นี้เปราะ
   และ `safeTap('btnCloseSlipModal', ...)` ชี้ไปที่ id ที่ไม่มีอยู่จริงในไฟล์ (ปุ่ม ✕ ไม่มี id) — เป็น no-op
