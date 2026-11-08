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
  - `load`: shifts = weight-ht + customshub `team/main/wshifts`, newest first, customshub ones tagged `src: 'chub'`; a customshub shift's records come from `team/main/wrecords`; pending count adds
    customshub's records with no shift. The date list and Export read both.
  - customshub rows show a "customshub" badge and no edit / delete / move buttons; the server refuses writes to an id it does not own.
  - `submit` duplicate check also looks in customshub (same as customshub already checks weight-ht), and says "(customshub)" in the where line.
  - Missing env or a customshub read error → weight-report works as today with only its own data and a small note "อ่านข้อมูล customshub ไม่ได้".
- **Owner's steps (key):** console.cloud.google.com › project customshub-pd › IAM & Admin › Service Accounts › Create (name `weight-report-reader`) › role Cloud Datastore Viewer › Done →
  open it › Keys › Add key › JSON → Vercel › pd21/weight-report › Settings › Environment Variables › `CUSTOMSHUB_SERVICE_ACCOUNT` (Production) = the whole JSON → delete the downloaded file.
