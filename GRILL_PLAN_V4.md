# แผนงาน V4: ช่อง "ข้อความรายงาน" (หน้ารายงานตรวจทีม) แก้ไข/พิมพ์ได้

สถานะ: ✅ ทำเสร็จ + verify ในเบราว์เซอร์แล้ว

## ขอบเขตงาน (จากผู้ใช้)
ในเมนู "รายงาน" (หน้า `page-team` / รายงานตรวจทีม) ช่อง "ข้อความรายงาน"
ให้ **พิมพ์แก้ไขได้** เพื่อแก้ข้อมูลก่อนกดคัดลอก

## บริบทที่สำรวจแล้ว
- ไฟล์: `weight-report/index.html` (single-file)
- เดิม กล่องข้อความคือ `<div id="teamChatBubble">` แสดงอย่างเดียว
  - ตั้งค่าด้วย `.textContent=result.text` (บรรทัด ~1481)
  - คัดลอกอ่านจาก `.textContent` (`copyTeamReport`)
  - ล้างด้วย `.textContent=''` (`clearTeamAll`)
- อยู่ในกล่อง flex `justify-content:center` (จัดกึ่งกลาง กว้างสุด 640px)

## การตัดสินใจ (checkpoint)

### ✅ Q1: วิธีทำให้พิมพ์ได้ → **(A) เปลี่ยนเป็น `<textarea>`**
เหตุผล: เนื้อหาเป็นข้อความล้วนหลายบรรทัด อ่าน `.value` ก้อปแม่นยำ ขึ้นบรรทัดครบ
(ไม่เลือก contenteditable เพราะกด Enter/วางอาจแทรก HTML ทำบรรทัดเพี้ยน)

### ✅ Q2: บอกว่าแก้ไขได้ยังไง → **(A) ไม่มี hint พิเศษ** — คลิกแล้วพิมพ์ได้เลย

### ✅ Q3: ความสูงกล่อง → **(A) auto-grow** ขยายตามข้อความ ไม่มี scrollbar ในช่อง

## สิ่งที่แก้ (index.html)
1. `<div id="teamChatBubble">` → `<textarea id="teamChatBubble" oninput="autoGrowTeam()" spellcheck="false">`
   - คงสไตล์ bubble เดิม (พื้นขาว, เงา, มุมโค้ง 18/18/18/4, ขอบเทา)
   - เพิ่ม: `font-family:inherit; resize:none; outline:none; overflow:hidden; min-height:120px; box-sizing:border-box`
   - **แก้ปัญหา flex:** textarea เป็น flex child จะหดเหลือความกว้างตาม `cols` (~46px)
     → เปลี่ยน `width:100%` เป็น `flex:1 1 100%; min-width:0` (คง `max-width:640px`)
2. `runReadTeam`: `.textContent=result.text` → `.value=result.text; autoGrowTeam();`
3. เพิ่มฟังก์ชัน `autoGrowTeam()` — `height='auto'` แล้วตั้ง `= scrollHeight+'px'`
4. `copyTeamReport`: อ่านจาก `.value` แทน `.textContent`
5. `clearTeamAll`: `.value=''` + รีเซ็ต `.style.height=''`

## ผลการทดสอบ (เบราว์เซอร์ mobile 375px)
- textarea กว้างเต็มจอ (311px), auto-grow 147px (4 บรรทัด) → 230px เมื่อเพิ่มบรรทัด ✓
- พิมพ์/แก้ไขได้จริง, oninput ยิง autoGrowTeam ✓
- คัดลอกอ่าน `.value` = ข้อความที่แก้แล้ว ขึ้นบรรทัดครบ ✓
- หน้าตากล่องเหมือน bubble เดิมทุกอย่าง ✓
- ไม่มี console error ✓
