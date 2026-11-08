# V28 — weight-report shows what the team records in customshub (grill started 2026-11-08)

- **Owner's ask:** ใบชั่ง typed in customshub (Firestore `customshub-pd` › `team/main/wshifts|wrecords`) should also be seen on weight-report.vercel.app, which today sees only its own `weight-ht`.
  (customshub already reads weight-ht live and read-only through `/api/weight-ht` with the `WEIGHT_HT_SA` service account — customshub D17/D85.)
- **Q1 (2026-11-08) Read across, the mirror of customshub's bridge.** weight-report reads customshub's team data read-only and badges it "customshub"; each record is edited only where it was typed.
  Not chosen: one shared database (customshub writing into weight-ht), or retiring weight-report.
- **Found:** `api/summary.js` uses firebase-admin with `FIREBASE_SERVICE_ACCOUNT` (weight-ht). Actions that list data: `load` (shifts + records of one shift + pending count), the date list
  (`dateIso`), `submit` duplicate check (`findDuplicate`), export settings. customshub's shapes come from this app (same field names), shifts/records carry `shiftId`, `createdAt`.
- **Q2 (2026-11-08) A read-only service account.** New service account in project `customshub-pd` with only **Cloud Datastore Viewer**; its JSON key goes to Vercel Production as
  `CUSTOMSHUB_SERVICE_ACCOUNT`. The owner creates the key (Google Cloud Console); the app never writes to customshub.
- **Settled without a question (mirror of customshub's bridge):**
  - `load`: shifts = weight-ht + customshub `team/main/wshifts`, newest first, customshub ones carry `src: 'chub'` (data only, not shown); a customshub shift's records come from `team/main/wrecords`; pending count adds
    customshub's records with no shift. The date list and Export read both.
  - **Q3 (2026-11-08) No customshub badge.** customshub shifts and rows look like the others; opening one shows a small line "แก้ไขได้ที่ customshub" in place of the edit / delete / move
    buttons. The server refuses writes to an id it does not own.
  - The duplicate warning's where line keeps "(customshub)" so the person knows where to fix it.
  - `submit` duplicate check also looks in customshub (same as customshub already checks weight-ht).
  - Missing env or a customshub read error → weight-report works as today with only its own data and a small note "อ่านข้อมูล customshub ไม่ได้".
- **Owner's steps (key):** console.cloud.google.com › project customshub-pd › IAM & Admin › Service Accounts › Create (name `weight-report-reader`) › role Cloud Datastore Viewer › Done →
  open it › Keys › Add key › JSON → Vercel › pd21/weight-report › Settings › Environment Variables › `CUSTOMSHUB_SERVICE_ACCOUNT` (Production) = the whole JSON → delete the downloaded file.
- **Built (2026-11-08, not deployed):**
  - `api/summary.js`: second firebase-admin app `chub` from `CUSTOMSHUB_SERVICE_ACCOUNT` (absent → behaves exactly as before, no note). `chubRead` never lets a customshub error fail a call —
    it returns the fallback plus `chubNote` "อ่านข้อมูล customshub ไม่ได้". `load` merges shifts (newest first) and pending count, reads a customshub shift's records from `wrecords`;
    `recordsByDate` returns both. `submit` / `createRecord` refuse a declaration already in customshub with "ใบขนนี้มีอยู่แล้วในเวร … (customshub) — แก้ไขได้ที่ customshub" (no replace offer across
    systems). `updateRecord` / `deleteRecord` / `deleteShift` on an id that is not ours → 404 with "แก้ไขได้ที่ customshub" (deleteRecord used to succeed silently on a missing id).
  - `index.html`: no badge; a customshub record opens a read-only sheet ending "แก้ไขได้ที่ customshub"; edit shift / delete shift / add ใบขน on a customshub shift → toast instead;
    `chubNote` shows as a notice at the top of สรุปผล.
  - Checked: an in-memory Firestore harness for both projects (load order, records, pending, date list, write refusals, duplicate refusal, customshub down → weighing still saves) — all
    pass; the page at 375 px with a mocked `sumApi` (notice, read-only sheet, blocked shift edit).
  - Not checked: real `customshub-pd` with the new service account (needs the owner's key in Vercel), iPhone.
- **Known look-alike:** a shift made on both sites for the same dates shows twice in the shift list with the same label (no badge, by Q3).
- **V28 LIVE 2026-11-08** (6ab7262, Vercel Ready, HTML md5 = local). `CUSTOMSHUB_SERVICE_ACCOUNT` set in Production (sensitive, cannot be read back). Not yet proven: a real read of customshub-pd — needs the สรุปผล PIN; if the key or role is wrong, สรุปผล shows "อ่านข้อมูล customshub ไม่ได้" and Vercel logs `[summary] customshub <error>`.
