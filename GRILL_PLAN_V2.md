# แผนงาน V2: ปรับ weight-report ให้เหมือน Referback + ปรับฟอร์ม

สถานะ: กำลังสัมภาษณ์ (grill-me) — รอบที่ 2

## ขอบเขตงาน 7 ข้อ (จากผู้ใช้)
1. เปลี่ยนรูปแบบการตกแต่งทั้งหมดให้เหมือนโปรเจค Referback
2. เปลี่ยนหัวข้อ "ระบบอ่านใบชั่งน้ำหนัก" → "อ่านใบชั่งน้ำหนัก"
3. คำเตือน "ตรวจสอบความถูกต้อง..." (alert สีฟ้าใน step2) → "ตรวจสอบความถูกต้องของข้อมูล"
4. ปรับ layout ฟอร์ม "ข้อมูลทั่วไป" ใหม่ทั้งบล็อก:
   - บรรทัด 1: เลขที่ใบขนสินค้า (เต็มแถว)
   - บรรทัด 2: วันที่ — ใช้แบบ Referback (3 select: วัน/เดือน/ปี พ.ศ.)
     - default = วันที่กดรัน (todayBE)
     - ยกเว้นเมื่ออ่านค่าจาก Gemini: ใช้ค่าจาก Gemini แต่ **เดือน+ปี ใช้ของวันที่รันข้อมูล**
   - บรรทัด 3: ผู้นำเข้า — chip แบบ "คำนำหน้าชื่อ" ของ Referback (pill buttons)
     สี: ดิเรก=น้ำเงิน, ติก๊ะ=เขียว, ก๊ะลี=ส้ม, อื่นๆ=ชมพู (เลือกอื่นๆ→กรอกเอง)
   - บรรทัด 4: [หน้า] ประเภทสินค้า = chip แบบเดียวกัน (หอม/กระเทียม/อื่นๆ→กรอก) | [หลัง] ประเทศกำเนิด
   - บรรทัด 5: [หน้า] น้ำหนักหน้าใบขน (KG) = ตัวเลขเท่านั้น | [หลัง] ชุดที่ (เหมือนเดิม)
5. เพิ่ม "ตัวหนา" ที่หัวตาราง "รายละเอียดการชั่งน้ำหนักรถและสินค้า" ทั้งหมด (bold ทุกหัวคอลัมน์)
6. ปรับรูปทรงปุ่มกดทั้งหมดให้เป็นแบบ Referback
7. เมนูชั่งน้ำหนัก: ตอนอัปโหลดรูปต้องคลิกหลายครั้ง → ลดจำนวนคลิก

## บริบทที่สำรวจแล้ว

### Referback (`/Referback`) — โปรเจคอ้างอิงดีไซน์
- Stack: **React 19 + Tailwind CSS 4 + Vite** (multi-file build) — คนละ stack กับ weight-report
- Font: **IBM Plex Sans Thai** + IBM Plex Mono (ตัวเลข)
- ธีมสี (violet/indigo iOS wellness):
  - `--color-bg:#f4f4fb`, `--color-bg-dim:#ecebf7`, `--color-card:#fff`
  - `--color-ink:#1e1b39`, `--color-ink-soft:#6b6a8a`, `--color-line:#e6e4f2`
  - `--color-violet:#5b53e0`, `--color-violet-soft:#7c7cf0`, `--color-violet-deep:#4f46c9`
  - `--shadow-card:0 8px 30px -12px rgba(79,70,201,0.25)`
  - พื้นหลัง body มี radial-gradient สีม่วงจางด้านบน
- `.card` = white, radius 1rem, violet shadow, border line
- `.btn-primary` = gradient violet (135deg soft→deep), radius 0.875rem, padding 0.7rem 1rem, weight 600, active translateY(1px)
- `.input` = radius 0.75rem, border line, focus = violet ring `0 0 0 3px rgba(124,124,240,.18)`
- Chip เลือก (คำนำหน้าชื่อ, `Add.jsx`): `flex flex-wrap gap-2`, ปุ่ม `px-3.5 py-2 rounded-xl text-sm border`, selected = `violet-gradient text-white`
- ThaiDateField: `grid grid-cols-3 gap-2` ของ 3 `<select class=input>` (วัน / เดือนเต็มไทย / ปีพ.ศ. ช่วง now+1 ถึง now-5)
- Bottom nav: floating pill card (`max-w-md`, `rounded-[1.75rem]`), active = violet-gradient
- date.js: พ.ศ. = ค.ศ.+543, todayBE(), THAI_MONTHS_FULL, makeBE(y,m,d) → "YYYY-MM-DD"

### weight-report (`/weight-report/index.html`) — ไฟล์เดียว vanilla
- Stack: **single-file HTML/CSS/JS** เปล่าๆ, deploy static บน Vercel, เรียก `/api/gemini`
- Font: Sarabun / Noto Sans Thai
- ธีมสี orange: `--orange:#E8691A`, `--orange-light:#FDF0E6`, bg `#F2EDE6`
- Bottom nav มี floating pill card อยู่แล้ว (โครงคล้าย Referback แต่ active สีส้ม)
- ฟอร์มปัจจุบัน (ข้อมูลทั่วไป, บรรทัด 337–382):
  - เลขที่ใบขน (เต็มแถว) → grid 2col: ผู้นำเข้า(select)|วันที่(text) / ประเภทสินค้า(datalist)|ประเทศกำเนิด / น้ำหนักหน้าใบขน(number)|ชุดที่
  - ผู้นำเข้าปัจจุบัน = `<select>` ดิเรก/ติก๊ะ/ก๊ะลี/อื่นๆ + input เมื่อเลือกอื่นๆ
  - วันที่ = `<input type=text>` + normThaiDate/checkDateWarning
- Alert ข้อ 3 = `#editAlert` "✅ ตรวจสอบความถูกต้องก่อนสร้างรายงาน — ช่องที่มี * ต้องกรอกให้ครบ"
- หัวข้อข้อ 2 = header-title "ระบบอ่านใบชั่งน้ำหนัก"
- ปุ่มต่างๆ: `.btn`, `.btn-primary`(ส้ม), `.btn-secondary`, `.btn-gen`, ปุ่ม Manual(เพิ่มรอบก่อน), addRow ฯลฯ

## คำถาม/การตัดสินใจ (checkpoint)

### ✅ D0: สถาปัตยกรรม (ตัดสินเอง, ความมั่นใจสูง)
คงเป็น **single-file vanilla HTML/CSS/JS ไฟล์เดียว** ตามเดิม — ไม่ rewrite เป็น React/Vite/Tailwind
เหตุผล: user บอก "เอา layout/ทรงปุ่ม/การ์ด/ฟอนต์...มา" = restyle ในที่เดิม ไม่ใช่เขียนใหม่;
การ rewrite จะเสี่ยงพัง flow Gemini ที่ใช้งานได้อยู่ และ deploy static บน Vercel อยู่แล้ว
→ จะ port เฉพาะ "design language" (โทเคนสี/เงา/ radius / ทรงปุ่ม / chip / input / font) มาเป็น CSS ธรรมดา

### ✅ Q1: สีหลักของแอป
**ตัดสินใจ:** คงสีส้ม (#E8691A) เป็น accent หลัก แต่นำ **layout / ทรงปุ่ม / สไตล์การ์ด / สไตล์ input / chip / ฟอนต์** ของ Referback มาใช้
- ปุ่ม primary: ใช้ "ทรง" ของ Referback (radius ~0.875rem, padding, weight 600, active translateY, gradient) แต่ **ไล่เฉดเป็นสีส้ม** (แทน violet)
- การ์ด: radius 1rem, เงานุ่มแบบ Referback แต่โทนเงาปรับเข้ากับส้ม
- ฟอนต์: เปลี่ยนเป็น **IBM Plex Sans Thai** (โหลดผ่าน Google Fonts link เหมือน Referback) — ปัจจุบัน weight-report ไม่มี font link (ใช้ Sarabun ของระบบ)
- chip เลือก (ผู้นำเข้า/ประเภทสินค้า): pill แบบ Referback แต่ selected ใช้สีเฉพาะตามข้อ 4

### ✅ D5 (ข้อ 5): หัวตารางตัวหนา (ตัดสินเอง)
`table.dt thead th` มี `font-weight:700` อยู่แล้ว **แต่** ป้าย "(KG)" ในหัวคอลัมน์ 3–4 (บรรทัด 406–407)
ใช้ `<span style="font-weight:400">` → ทำให้ส่วนนั้นไม่หนา
→ **แก้:** เอา font-weight:400 ออก/เปลี่ยนเป็นหนา ให้หัวตารางบนหน้าจอ **หนาทั้งหมด**
(รูปรายงาน canvas หัวตารางเป็น `bold` อยู่แล้ว บรรทัด 1055 — ไม่ต้องแก้)

### ✅ D7 (ข้อ 7): ลดคลิกตอนอัปโหลด (ตัดสินเอง)
**สาเหตุ:** หน้า weight ใช้ JS `fileInput.click()` ผูก touchend+click โดย input เป็น 1px + `pointer-events:none`
→ บน iOS ต้องแตะหลายครั้ง (preventDefault บน touchend ทำให้ gesture ไม่ trusted ครั้งแรก)
**หน้า team ใช้ `<label for="teamFileInput">` (native, แตะครั้งเดียวติด) อยู่แล้ว**
→ **แก้:** เปลี่ยน upload หน้า weight ให้ใช้ `<label for="fileInput">` แบบ native เหมือนหน้า team
- ยัง drag-drop ได้ (label ไม่ทำลาย ondrop)
- ตอนมี preview รูปแล้ว จัดให้ปุ่ม X (ลบรูป) กดได้ ไม่ชนกับ label (wrap เฉพาะ placeholder)
- ตรวจด้วยการทดสอบใน browser จริง

### ✅ Q3 (ข้อ 4 date): กฎวันที่จาก Gemini
**ตัดสินใจ:** วันที่ = 3 select (วัน/เดือน/ปี พ.ศ.) แบบ Referback ใช้ **ชื่อเดือนเต็ม** (มกราคม…ธันวาคม ไม่ใช่ ม.ค.)
- default = วันที่กดรัน (today, พ.ศ.)
- เมื่ออ่านจาก Gemini: **วัน** = จาก Gemini, **เดือน+ปี** = ของวันที่รัน
  - ตัวอย่าง: run 12 ก.ค. 2569, Gemini="25 มิ.ย. 2568" → ผล = **25 กรกฎาคม 2569**
  - ถ้า Gemini อ่านวันไม่ได้ → fallback วัน = วันที่วันนี้ (default)
- **ผลข้างเคียง:** ค่าที่ป้อนเข้า report (อ่าน `f_date.value` บรรทัด 941) จะกลายเป็นชื่อเดือนเต็ม → รูปรายงานจะแสดง "25 กรกฎาคม 2569" (เต็ม) แทนตัวย่อเดิม
- **Implementation:** เก็บ hidden `#f_date` (value = "D เดือนเต็ม พ.ศ.") sync จาก 3 select → validation/report เดิมใช้ได้ต่อ
- ปี range: ใช้แบบ Referback (now+1 ถึง now-5)
- ฟังก์ชัน `checkDateWarning`/`normThaiDate` เดิมเลิกใช้ (3 select ป้องกัน invalid อยู่แล้ว) — เอา warning ออก

### ✅ Q5 (ข้อ 2): ขอบเขต rename หัวข้อ
**ตัดสินใจ:** เปลี่ยน **เฉพาะหัวเว็บที่เห็นบนหน้าจอ** "ระบบอ่านใบชั่งน้ำหนัก" → "อ่านใบชั่งน้ำหนัก"
- แก้ที่ line 276 (`#headerTitle`) และ line 1302 (`titles.weight` ที่ตั้ง header ตอนสลับหน้า)
- **ไม่แตะ:** `<title>` แท็บ (48), footer รูปรายงาน (1149), manifest PWA name

### ✅ D6 (ข้อ 6): ทรงปุ่มทั้งหมดแบบ Referback (ตัดสินเอง, อิง Q1)
พอร์ต "ทรง" ปุ่มของ Referback มาทุกปุ่ม โดยคงความหมายสี:
- `.btn-primary` / `.btn-gen` (อ่าน Gemini, สร้างรายงาน, บันทึกรูป) → **orange gradient pill** (radius ~0.875rem, padding 0.7rem 1rem, weight 600, `:active` translateY(1px))
- `.btn-secondary` (Manual, ล้างรูป, สร้างใหม่, ปิด) → outline แบบ Referback (border line, radius, text เข้มอ่อน)
- ปุ่ม danger (Clear #DC2626) → คงสีแดง แต่ใช้ทรง Referback
- ปุ่มเล็ก (`btn-del` X ในแถว, `btn-add-row`, X ในรูป preview, nav items) → ปรับ radius/สไตล์ให้เข้าชุด

### ✅ Q4 (ข้อ 4 chips): chip ผู้นำเข้า + ประเภทสินค้า
**ตัดสินใจ:**
- รูปแบบ = pill chips แบบ "คำนำหน้าชื่อ" ของ Referback (`flex flex-wrap gap`, ปุ่ม rounded-xl, selected = สีทึบ/gradient + text ขาว)
- **ผู้นำเข้า** chips: ดิเรก, ติก๊ะ, ก๊ะลี, อื่นๆ — สี selected:
  - ดิเรก = น้ำเงิน, ติก๊ะ = เขียว, ก๊ะลี = ส้ม, อื่นๆ = ชมพู
  - เลือก "อื่นๆ" → โผล่ input ให้กรอกเอง
- **ประเภทสินค้า** chips: หอม, กระเทียม, อื่นๆ (เลือกอื่นๆ → กรอกเอง)
  - สี selected: หอม/กระเทียม = ส้ม (brand), อื่นๆ = ชมพู (สอดคล้อง importer) — *ผู้ใช้ไม่ระบุสี goods ชัด → ตัดสินตามนี้*
- **สถานะเริ่มต้น:** ไม่เลือกอะไร (Manual/เปิดใหม่ = ว่าง ให้ผู้ใช้กด)
- **หลัง Gemini:** auto-เลือก chip ตามค่าที่อ่านได้ ("เลือกตามที่ gemini อ่านค่าได้"); ถ้าค่าไม่ตรง known → เลือก "อื่นๆ" + เติมข้อความในช่อง
- ทั้งสองยังเป็น required field (ต้องมีค่าก่อนสร้างรายงาน)

### ✅ Q6 (ข้อ 3): ข้อความ alert
**ตัดสินใจ:** เปลี่ยน `#editAlert` เป็น **"✅ ตรวจสอบความถูกต้องของข้อมูล — ช่องที่มี * ต้องกรอกให้ครบ"**
(เปลี่ยนเฉพาะวลีหน้า คง hint "ช่องที่มี * ต้องกรอกให้ครบ")

### ✅ Q2: ขอบเขตฟอนต์
**ตัดสินใจ:** เปลี่ยนเฉพาะ **หน้าเว็บ (UI)** เป็น IBM Plex Sans Thai — **รูปรายงาน (canvas) คง Sarabun เดิม** (ไม่แตะ canvas font, เลี่ยงปัญหา font โหลดไม่ทันตอนวาด)
- หมายเหตุ: canvas ใช้ Sarabun อยู่หลายบรรทัด (994–1149) รวม footer "ระบบอ่านใบชั่งน้ำหนัก | Gemini Vision" บรรทัด 1149 → footer นี้เกี่ยวกับข้อ 2 ด้วย (ดู Q ข้อ 2 ด้านล่าง)

---

## สรุปแผน implement (ครบทั้ง 7 ข้อ) — รอ user ยืนยันก่อนเริ่ม

**Design system (ข้อ 1 + 6):** พอร์ต design language ของ Referback มาเป็น CSS ธรรมดาในไฟล์เดียว
- เพิ่ม Google Fonts link: IBM Plex Sans Thai → ใช้เป็นฟอนต์ UI (canvas คง Sarabun)
- ปรับ `.card`/`.step-card` (radius ~1rem, เงานุ่ม), `.input` (radius .75rem, focus ring ส้ม)
- ปุ่มทุกชนิดใช้ทรง Referback: primary=orange gradient pill, secondary=outline, danger=แดงทรงใหม่
- คง accent ส้ม (#E8691A) เป็นหลัก (ไม่เปลี่ยนเป็น violet)

**ข้อ 2:** header "ระบบอ่านใบชั่งน้ำหนัก" → "อ่านใบชั่งน้ำหนัก" (line 276 + 1302 เท่านั้น)

**ข้อ 3:** `#editAlert` → "✅ ตรวจสอบความถูกต้องของข้อมูล — ช่องที่มี * ต้องกรอกให้ครบ"

**ข้อ 4:** rebuild บล็อก "ข้อมูลทั่วไป":
- บรรทัด1: เลขที่ใบขนสินค้า (เต็มแถว, เหมือนเดิม)
- บรรทัด2: วันที่ = 3 select (วัน/เดือนเต็ม/ปีพ.ศ.) แบบ Referback; default=today; Gemini→วันจากGemini + เดือน/ปีจากtoday; hidden #f_date sync ให้ report/validation เดิมใช้ต่อ
- บรรทัด3: ผู้นำเข้า = chips (ดิเรก=น้ำเงิน/ติก๊ะ=เขียว/ก๊ะลี=ส้ม/อื่นๆ=ชมพู, อื่นๆ→input)
- บรรทัด4: [หน้า]ประเภทสินค้า chips (หอม/กระเทียม/อื่นๆ, อื่นๆ→input) | [หลัง]ประเทศกำเนิด
- บรรทัด5: [หน้า]น้ำหนักหน้าใบขน(KG) เฉพาะตัวเลข | [หลัง]ชุดที่ (เหมือนเดิม)
- chips เริ่มต้นว่าง; หลัง Gemini auto-select; ยัง required

**ข้อ 5:** หัวตาราง detail บนหน้าจอ → หนาทั้งหมด (เอา font-weight:400 ของ "(KG)" ออก)

**ข้อ 7:** เปลี่ยน upload หน้า weight เป็น `<label for="fileInput">` native (แตะครั้งเดียว) เหมือนหน้า team; คง drag-drop + ปุ่มลบรูป

**ทดสอบ:** เปิด local server + browser ตรวจ: อัปโหลด 1 คลิก, chips สี, date 3 select + กฎ Gemini, ปุ่ม/ฟอนต์/การ์ด, หัวตารางหนา, rename, alert
