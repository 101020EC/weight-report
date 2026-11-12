// api/summary.js — เมนูสรุปผล: ข้อมูลอยู่ Firestore (weight-ht) เข้าถึงผ่านฟังก์ชันนี้เท่านั้น
// rules ของ Firestore ปิดหมด (firestore.rules) — ดู GRILL_PLAN_V17.md D1–D4
//
// POST { action, ... }
//   submit            — ส่งใบขนจากหน้าชั่ง (ไม่ต้องใช้ PIN)
//   login { pin }     — ตรวจ PIN คืน token อายุ 15 วัน
//   ที่เหลือต้องมี header  Authorization: Bearer <token>
//   load { shiftId? } · createShift · updateShift { startDate, endDate } · deleteShift { pin } ·
//   createRecord { shiftId } · updateRecord · moveRecord { id, shiftId } · deleteRecord · renameImporter · recordsByDate { dateIso } ·
//   exportUnlock { pin } (EXPORT_PIN) · exportSaveSettings { exportToken, settings }
// V32 (= customshub D108/D109): weight-ht is the one store for ใบชั่ง — customshub reads and writes it through its own Function,
//   so the V28/V30 reads of customshub team/main/wshifts|wrecords are gone. CUSTOMSHUB_SERVICE_ACCOUNT is used only for `plates`.

const crypto = require('crypto');
const { originOk, ipTag } = require('../lib/guard.js');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const LOCK_MAX_FAILS = 8;
const LOCK_MAX_FAILS_IP = 30;
const EXPORT_TOKEN_TTL_MS = 10 * 60 * 1000;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const SHIFT_MAX_DAYS = 7;

let _db = null;
function db() {
  if (_db) return _db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT');
  // V30: ต้องหาแอป default ตามชื่อ — ถ้า `plates` สร้างแอป 'chub' ไว้ก่อน getApps().length = 1 แล้วแอป default
  // ไม่เคยถูกสร้าง → login/submit พัง "The default Firebase app does not exist" (เกิดข้อผิดพลาดในระบบ)
  const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp({ credential: cert(JSON.parse(raw)) });
  _db = getFirestore(app);
  return _db;
}

// customshub (อ่านอย่างเดียว, รายชื่อทะเบียนเท่านั้น) — แอป firebase-admin ตัวที่สองชื่อ 'chub' · ไม่ได้ตั้งค่า = null
let _chub;
function chub() {
  if (_chub !== undefined) return _chub;
  const raw = process.env.CUSTOMSHUB_SERVICE_ACCOUNT;
  if (!raw) return (_chub = null);
  const app = getApps().find(a => a.name === 'chub') || initializeApp({ credential: cert(JSON.parse(raw)) }, 'chub');
  return (_chub = getFirestore(app).collection('team').doc('main'));
}
const CHUB_NOTE = 'อ่านข้อมูล customshub ไม่ได้';
// อ่าน customshub แบบไม่ทำให้ฟังก์ชันพัง: ผิดพลาด → ค่า fallback + note
async function chubRead(fn, fallback) {
  const t = chub();
  if (!t) return { v: fallback, note: null };
  try { return { v: await fn(t), note: null }; } catch (e) { console.error('[summary] customshub', e.message); return { v: fallback, note: CHUB_NOTE }; }
}
const NOT_FOUND = 'ไม่พบรายการนี้';

class HttpError extends Error {
  constructor(status, message, auth = false, extra = null) { super(message); this.status = status; this.auth = auth; this.extra = extra; }
}

// ── PIN + token ─────────────────────────────────────────────
function pinConfig() {
  const pin = (process.env.SUMMARY_PIN || '').trim();
  // ไม่มี default: ไม่ตั้ง env = เข้าเมนูสรุปผลไม่ได้เลย (D3)
  if (!/^\d{4}$/.test(pin)) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า SUMMARY_PIN (ตัวเลข 4 หลัก)');
  return pin;
}

// secret ผูกกับ PIN — เปลี่ยน PIN ใน Vercel แล้ว token เก่าทุกเครื่องใช้ไม่ได้ทันที
function tokenSecret() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  return crypto.createHash('sha256').update(`summary-token|${sa}|${pinConfig()}`).digest();
}

function signToken(exp) {
  const sig = crypto.createHmac('sha256', tokenSecret()).update(`v1.${exp}`).digest('base64url');
  return `${exp}.${sig}`;
}

function verifyToken(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\d+)\.([\w-]+)$/);
  if (!m) throw new HttpError(401, 'กรุณาใส่รหัสเข้าเมนูสรุปผล', true);
  const exp = Number(m[1]);
  const expected = Buffer.from(signToken(exp).split('.')[1]);
  const given = Buffer.from(m[2]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected) || Date.now() > exp) {
    throw new HttpError(401, 'รหัสหมดอายุ กรุณาใส่รหัสใหม่', true);
  }
}

// ล็อกต่อ IP + เครื่อง (V24 Q4c): คนที่ใส่ผิดถูกล็อกคนเดียว ไม่ใช่ทั้งที่ทำงานที่ใช้ IP เดียวกัน
// เพดานรวมต่อ IP กันสุ่มรหัสด้วยการเปลี่ยน device id · ตัวนับแยกตามชนิดรหัส (summary / export) (Q4a)
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}
function deviceId(req) {
  const d = String(req.headers['x-device-id'] || '');
  return /^[\w-]{8,64}$/.test(d) ? d : 'none';
}
const hashKey = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

// ตรวจ PIN: ผิดครบ 8 ครั้งต่อเครื่อง หรือ 30 ครั้งต่อ IP ภายใน 15 นาที = ล็อก 15 นาที · บอกจำนวนครั้งที่เหลือ (Q4b)
async function checkPin(req, pin, kind = 'summary') {
  const expected = kind === 'export' ? exportPinConfig() : pinConfig();
  const ip = clientIp(req);
  const col = db().collection('pin_attempts');
  const counters = [
    { ref: col.doc(`${kind}_dev_${hashKey(`${ip}|${deviceId(req)}`)}`), max: LOCK_MAX_FAILS },
    { ref: col.doc(`${kind}_ip_${hashKey(ip)}`), max: LOCK_MAX_FAILS_IP },
  ];
  const now = Date.now();
  const snaps = await Promise.all(counters.map(c => c.ref.get()));
  counters.forEach((c, i) => {
    let { fails = 0, windowStart = now } = snaps[i].exists ? snaps[i].data() : {};
    if (now - windowStart > LOCK_WINDOW_MS) { fails = 0; windowStart = now; }
    Object.assign(c, { fails, windowStart, exists: snaps[i].exists });
  });
  const locked = counters.filter(c => c.fails >= c.max);
  if (locked.length) {
    const until = Math.max(...locked.map(c => c.windowStart + LOCK_WINDOW_MS));
    throw new HttpError(429, `ใส่รหัสผิดหลายครั้ง กรุณารอ ${Math.ceil((until - now) / 60000)} นาที`);
  }
  const a = Buffer.from(String(pin || ''));
  const b = Buffer.from(expected);
  await cleanOldAttempts(col, now);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    await Promise.all(counters.filter(c => c.exists).map(c => c.ref.delete()));
    return;
  }
  // V33 (WR-DATA-04): expireAt lets a Firestore TTL policy drop them too (optional, set in the Console)
  await Promise.all(counters.map(c => c.ref.set({ fails: c.fails + 1, windowStart: c.windowStart, expireAt: new Date(c.windowStart + LOCK_WINDOW_MS) })));
  const left = Math.min(...counters.map(c => c.max - c.fails - 1));
  throw new HttpError(401, left > 0
    ? `รหัสไม่ถูกต้อง เหลืออีก ${left} ครั้ง`
    : `รหัสไม่ถูกต้อง — ล็อก ${LOCK_WINDOW_MS / 60000} นาที`);
}

// V33 (WR-DATA-04): a device id is chosen by the caller, so counters for ids never used again would pile up — every PIN check
// removes up to 20 whose window has long passed (a lock lasts LOCK_WINDOW_MS). Failing to clean never blocks the check.
async function cleanOldAttempts(col, now) {
  try {
    const old = await col.where('windowStart', '<', now - LOCK_WINDOW_MS).limit(20).get();
    if (old.size) { const b = db().batch(); old.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  } catch (e) { console.warn('[summary] clean pin_attempts', e.message); }
}

// ── ส่งออก Excel (V24) — รหัสแยก EXPORT_PIN · token อายุสั้นใช้บันทึกค่าตั้งค่า ──
function exportPinConfig() {
  const pin = (process.env.EXPORT_PIN || '').trim();
  if (!/^\d{4}$/.test(pin)) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า EXPORT_PIN (ตัวเลข 4 หลัก)');
  return pin;
}
function signExportToken(exp) {
  const secret = crypto.createHash('sha256').update(`export-token|${process.env.FIREBASE_SERVICE_ACCOUNT || ''}|${exportPinConfig()}`).digest();
  return `${exp}.${crypto.createHmac('sha256', secret).update(`x1.${exp}`).digest('base64url')}`;
}
function verifyExportToken(token) {
  const m = String(token || '').match(/^(\d+)\.([\w-]+)$/);
  const ok = m && Date.now() <= Number(m[1]) && (() => {
    const expected = Buffer.from(signExportToken(Number(m[1])).split('.')[1]);
    const given = Buffer.from(m[2]);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  })();
  if (!ok) throw new HttpError(403, 'หมดเวลาส่งออก กรุณากดส่งออกและใส่รหัสใหม่');
}

// ค่าเริ่มต้นของหน้าตั้งค่าส่งออก (Q5–Q7) — ค่าที่ผู้ใช้แก้เก็บที่ settings/export ใช้ร่วมทุกเครื่อง (Q6)
const EXPORT_DEFAULTS = {
  prices: { 'หอม': 2, 'กระเทียม': 3 },
  ratePerDecl: 1500,
  includeNegative: false, // V26 Q4: ไม่รวมแถวที่ส่วนต่างติดลบ
  companies: {
    'ดิเรก': { 'หอม': 'บริษัท โกลเด้น ไลน์ อิมพอร์ท เอ็กพอร์ท จำกัด', 'กระเทียม': 'บริษัท โกลเด้น ไลน์ อิมพอร์ท เอ็กพอร์ท จำกัด' },
    'ติก๊ะ': { 'หอม': 'บริษัท ริสกี อินเตอร์ ฟู๊ดส์ อิมพอร์ต เอ็กซ์พอร์ต จำกัด', 'กระเทียม': 'บริษัท มาร์ฮาบัน จำกัด' },
    'ก๊ะลี': { 'หอม': 'บริษัท เออาร์เอ็น อินเตอร์เทรด จำกัด', 'กระเทียม': 'บริษัท เออาร์เอ็น อินเตอร์เทรด จำกัด' },
  },
};

function exportSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const prices = {};
  Object.entries(s.prices && typeof s.prices === 'object' ? s.prices : {}).slice(0, 10)
    .forEach(([g, v]) => { prices[text(g, 'สินค้า', 40)] = num(v, `ราคา${g}`); });
  const companies = {};
  Object.entries(s.companies && typeof s.companies === 'object' ? s.companies : {}).slice(0, 30).forEach(([imp, m]) => {
    const row = {};
    Object.entries(m && typeof m === 'object' ? m : {}).slice(0, 10)
      .forEach(([g, v]) => { row[text(g, 'สินค้า', 40)] = text(v, `ชื่อบริษัท ${imp}`, 120, false); });
    companies[text(imp, 'ผู้นำเข้า')] = row;
  });
  return { prices, ratePerDecl: num(s.ratePerDecl, 'อัตราต่อใบขน'), includeNegative: s.includeNegative === true, companies };
}

// ── validation helpers ──────────────────────────────────────
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v, field) {
  const s = String(v || '');
  const d = new Date(`${s}T00:00:00Z`);
  if (!ISO_RE.test(s) || isNaN(d) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, `${field} ไม่ถูกต้อง`);
  return s;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

// วันนี้ตามเวลาไทย (server ของ Vercel เป็น UTC)
function todayBangkok() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

function text(v, field, max = 80, required = true) {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw new HttpError(400, `กรุณาระบุ${field}`);
  if (s.length > max) throw new HttpError(400, `${field} ยาวเกินไป`);
  return s;
}

function num(v, field) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, `${field} ไม่ถูกต้อง`);
  return Math.round(n * 100) / 100;
}

// id เริ่มต้นของใบขน = hash(เลขใบขน + ชุดที่) — การตรวจซ้ำอยู่ใน findDuplicate
function recordId(declarationNo, period) {
  const key = `${declarationNo.replace(/[^0-9A-Za-z]/g, '').toUpperCase()}|${period.replace(/\s+/g, '')}`;
  return 'rec_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
}

function recordFields(body) {
  const declaredWeight = num(body.declaredWeight, 'น้ำหนักหน้าใบขน');
  const netWeight = num(body.netWeight, 'น้ำหนักชั่งจริง');
  return {
    importer: text(body.importer, 'ผู้นำเข้า'),
    goodsType: text(body.goodsType, 'ประเภทสินค้า'),
    origin: text(body.origin, 'ประเทศกำเนิด', 80, false),
    declarationNo: text(body.declarationNo, 'เลขที่ใบขนสินค้า', 40),
    period: text(body.period, 'ชุดที่', 40, false),
    dateIso: isoDate(body.dateIso, 'วันที่'),
    declaredWeight,
    netWeight,
    diffWeight: Math.round((netWeight - declaredWeight) * 100) / 100,
  };
}

// ช่วงเวร 1–7 วัน (V19 Q5) — ไม่ส่ง endDate มา = ครบ 7 วัน
function shiftRange(body) {
  const startDate = isoDate(body.startDate, 'วันเริ่มเวร');
  const endDate = body.endDate ? isoDate(body.endDate, 'วันสิ้นสุดเวร') : addDays(startDate, SHIFT_MAX_DAYS - 1);
  if (endDate < startDate) throw new HttpError(400, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มเวร');
  if (endDate > addDays(startDate, SHIFT_MAX_DAYS - 1)) throw new HttpError(400, `เวรยาวได้ไม่เกิน ${SHIFT_MAX_DAYS} วัน`);
  return { startDate, endDate };
}

// เวรล่าสุด = เวรที่เปิดอยู่ ในช่วงวันเริ่มเวร–วันสิ้นสุด (D2) · V32: customshub ตั้งเวรที่นี่ด้วย (weight-ht ที่เดียว)
async function openShift() {
  const snap = await db().collection('shifts').orderBy('createdAt', 'desc').limit(10).get();
  const today = todayBangkok();
  const active = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .find(s => (s.startDate ? today >= s.startDate : true) && today <= s.endDate);
  return active || null;
}

async function recordsOf(shiftId) {
  const snap = await db().collection('records').where('shiftId', '==', shiftId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function commitInChunks(refs, apply) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db().batch();
    refs.slice(i, i + 400).forEach(r => apply(batch, r));
    await batch.commit();
  }
}

// ใบขนซ้ำ = เลขใบขน + ชุดที่ ตรงกัน · doc id ไม่เปลี่ยนตามการแก้เลขในหน้าแก้ไข จึงต้องค้นตามฟิลด์ด้วย (V23)
async function findDuplicate(fields) {
  const norm = s => String(s || '').replace(/\s+/g, '');
  const normNo = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const same = d => normNo(d.declarationNo) === normNo(fields.declarationNo) && norm(d.period) === norm(fields.period);
  const byField = (await db().collection('records').where('declarationNo', '==', fields.declarationNo).get())
    .docs.find(d => same(d.data()));
  if (byField) return byField;
  // พิมพ์เลขต่างรูปแบบ (ไม่มีขีด/ตัวเล็ก) แต่ id เดียวกัน — นับว่าซ้ำเฉพาะเมื่อเอกสารนั้นยังเป็นเลขเดียวกันจริง
  const byId = await db().collection('records').doc(recordId(fields.declarationNo, fields.period)).get();
  return byId.exists && same(byId.data()) ? byId : null;
}

// id ตามเลขใบขน ถ้าว่าง ไม่ว่างแล้ว (เอกสารเดิมถูกแก้เลขไป) ใช้ id อัตโนมัติ
async function newRecordRef(fields) {
  const ref = db().collection('records').doc(recordId(fields.declarationNo, fields.period));
  return (await ref.get()).exists ? db().collection('records').doc() : ref;
}

async function shiftLabel(shiftId) {
  const s = shiftId ? await db().collection('shifts').doc(shiftId).get() : null;
  if (s && s.exists) return `เวร ${thaiDate(s.data().startDate)} – ${thaiDate(s.data().endDate)}`;
  return shiftId ? 'เวรที่ถูกลบไปแล้ว' : 'รายการที่รอเข้าเวร';
}

// V31 (= customshub D105): ลบเวร/ใบขน → เก็บสำเนาไว้ที่ trash/{auto id} = {kind, shift, records, at, by} ก่อนลบ
// customshub (แอดมิน) แสดงในถังขยะใบชั่งและกู้คืนกลับมาที่นี่ด้วย id เดิม · V33: สำเนา + ลบในก้อนเดียว (deleteShift, deleteRecord)

// V33 (AUDIT-2026-11 WR-DATA-02): who changed what — log/{auto id} = {action, id, at, by, ip, before, after}. The team shares one
// PIN, so `by` is the device id (the same one the PIN lock uses) and ip a short hash. Best effort: a failed log never undoes the
// change. customshub's writes carry `by: customshub · <email>` on the documents themselves.
const slim = d => (d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'vehicles')) : null);
async function audit(req, action, id, before = null, after = null) {
  try {
    await db().collection('log').doc().set({ action, id: id || null, at: Date.now(), by: `weight-report · ${deviceId(req)}`, ip: ipTag(req), before: slim(before), after: slim(after) });
  } catch (e) { console.warn('[summary] log', action, e.message); }
}

// ── actions ─────────────────────────────────────────────────
const actions = {
  async submit(req, body) {
    const fields = recordFields(body);
    const vehicles = (Array.isArray(body.vehicles) ? body.vehicles : []).slice(0, 50).map(v => ({
      plate: text(v && v.plate, 'ทะเบียนรถ', 40, false),
      empty: num(v && v.empty, 'น้ำหนักรถเปล่า'),
      gross: num(v && v.gross, 'น้ำหนักชั่งได้'),
      net: num(v && v.net, 'น้ำหนักสุทธิ'),
    }));
    const shift = await openShift();
    const shiftId = shift ? shift.id : null;
    const now = Date.now();
    const dup = await findDuplicate(fields);
    // ซ้ำ → ไม่เขียนทับเอง ส่งข้อมูลเดิมกลับให้หน้าชั่งถามก่อน (V23 Q1) · replaceId ตรงกัน = ผู้ใช้ยืนยันแทนที่
    if (dup && body.replaceId !== dup.id) {
      const d = dup.data();
      throw new HttpError(409, 'ใบขนนี้มีอยู่แล้ว', false, {
        duplicate: {
          id: dup.id, where: await shiftLabel(d.shiftId), movesShift: (d.shiftId || null) !== shiftId,
          importer: d.importer, goodsType: d.goodsType, dateIso: d.dateIso,
          declaredWeight: d.declaredWeight, netWeight: d.netWeight, diffWeight: d.diffWeight,
        },
      });
    }
    const ref = dup ? dup.ref : await newRecordRef(fields);
    // แทนที่แล้วย้ายมาเวรที่เปิดอยู่ (Q2) คงเวลาสร้างเดิม
    await ref.set({ ...fields, vehicles, shiftId, createdAt: dup ? (dup.data().createdAt || now) : now, updatedAt: now });
    await audit(req, dup ? 'replace' : 'submit', ref.id, dup ? dup.data() : null, { ...fields, shiftId });
    return { id: ref.id, shiftId, replaced: !!dup };
  },

  async login(req, body) {
    await checkPin(req, body.pin);
    const exp = Date.now() + TOKEN_TTL_MS;
    return { token: signToken(exp), expiresAt: exp };
  },

  async load(req, body) {
    const [shiftsSnap, pending] = await Promise.all([
      db().collection('shifts').orderBy('createdAt', 'desc').limit(200).get(),
      db().collection('records').where('shiftId', '==', null).get(),
    ]);
    const shifts = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const selected = (body.shiftId && shifts.find(s => s.id === body.shiftId)) || shifts[0] || null;
    return {
      today: todayBangkok(),
      shifts,
      shift: selected,
      records: selected ? await recordsOf(selected.id) : [],
      pendingCount: pending.size,
      pending: pending.docs.map(d => ({ id: d.id, ...d.data() })), // V30 Q3: แก้/ลบ/ย้ายเข้าเวรได้
    };
  },

  async createShift(req, body) {
    const range = shiftRange(body);
    const ref = db().collection('shifts').doc();
    const now = Date.now();
    // ใบขนที่ส่งมาตอนยังไม่มีเวรเปิด → เข้าเวรใหม่นี้ (D2) · V33 (WR-DATA-05): เวร + ใบที่รออยู่ในก้อนเดียว (พังกลางทางไม่ค้างครึ่ง)
    const pending = await db().collection('records').where('shiftId', '==', null).get();
    if (pending.size < 500) {
      const b = db().batch();
      b.create(ref, { ...range, createdAt: now, updatedAt: now });
      pending.docs.forEach(d => b.update(d.ref, { shiftId: ref.id, updatedAt: now }));
      await b.commit();
    } else {
      await ref.set({ ...range, createdAt: now, updatedAt: now });
      await commitInChunks(pending.docs.map(d => d.ref), (b, r) => b.update(r, { shiftId: ref.id, updatedAt: now }));
    }
    await audit(req, 'createShift', ref.id, null, { ...range, attached: pending.size });
    return { id: ref.id, attached: pending.size };
  },

  async updateShift(req, body) {
    const ref = db().collection('shifts').doc(text(body.id, 'เวร', 60));
    const range = shiftRange(body);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'ไม่พบเวรนี้');
    await ref.update({ ...range, updatedAt: Date.now() });
    await audit(req, 'updateShift', ref.id, snap.data(), range);
    return { id: ref.id };
  },

  async deleteShift(req, body) {
    await checkPin(req, body.pin);
    const id = text(body.id, 'เวร', 60);
    const shiftSnap = await db().collection('shifts').doc(id).get();
    if (!shiftSnap.exists) throw new HttpError(404, 'ไม่พบเวรนี้');
    const recs = await db().collection('records').where('shiftId', '==', id).get();
    // V31: a copy goes to trash first (customshub › Setting › ถังขยะใบชั่ง puts it back) — no copy, no delete
    // V33 (WR-DATA-05): copy + deletes in one batch when they fit (≤ 500 writes), so a failure leaves nothing half done
    const copy = { kind: 'shift', shift: { id, ...shiftSnap.data() }, records: recs.docs.map(d => ({ id: d.id, ...d.data() })), at: Date.now(), by: `weight-report · ${deviceId(req)}` };
    if (recs.size <= 498) {
      const b = db().batch();
      b.set(db().collection('trash').doc(), copy);
      recs.docs.forEach(d => b.delete(d.ref));
      b.delete(db().collection('shifts').doc(id));
      await b.commit();
    } else {
      await db().collection('trash').doc().set(copy);
      await commitInChunks(recs.docs.map(d => d.ref), (b, r) => b.delete(r));
      await db().collection('shifts').doc(id).delete();
    }
    await audit(req, 'deleteShift', id, { ...shiftSnap.data(), records: recs.size });
    return { deletedRecords: recs.size };
  },

  // เพิ่มใบขน Manual เข้าเวรที่กำลังดู (V19 Q3) — ซ้ำ (เลขใบขน+ชุดที่) ไม่ว่าเวรไหน = ไม่บันทึก (Q4)
  async createRecord(req, body) {
    const fields = recordFields(body);
    const shiftRef = db().collection('shifts').doc(text(body.shiftId, 'เวร', 60));
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) throw new HttpError(404, 'ไม่พบเวรนี้');
    const existing = await findDuplicate(fields);
    if (existing) {
      throw new HttpError(409, `ใบขนนี้มีอยู่แล้วใน${await shiftLabel(existing.data().shiftId)} — แก้ไขที่รายการเดิม`);
    }
    const ref = await newRecordRef(fields);
    const now = Date.now();
    await ref.create({ ...fields, vehicles: [], shiftId: shiftRef.id, manual: true, createdAt: now, updatedAt: now });
    await audit(req, 'createRecord', ref.id, null, { ...fields, shiftId: shiftRef.id });
    return { id: ref.id };
  },

  // รายงานตรวจทีมแบบ Manual (V19 Q2): ใบขนของวันที่เลือก ข้ามทุกเวร
  async recordsByDate(req, body) {
    const dateIso = isoDate(body.dateIso, 'วันที่');
    const snap = await db().collection('records').where('dateIso', '==', dateIso).get();
    return { records: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  },

  async updateRecord(req, body) {
    const ref = db().collection('records').doc(text(body.id, 'รายการ', 60));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, NOT_FOUND);
    const fields = recordFields(body);
    // V33 (WR-DATA-03): changing the number (+ ชุดที่) to one another slip already has would count it twice
    const dup = await findDuplicate(fields);
    if (dup && dup.id !== ref.id) throw new HttpError(409, `ใบขนนี้มีอยู่แล้วใน${await shiftLabel(dup.data().shiftId)} — แก้ไขที่รายการเดิม`);
    await ref.update({ ...fields, updatedAt: Date.now() });
    await audit(req, 'updateRecord', ref.id, snap.data(), fields);
    return { id: ref.id };
  },

  // V30 Q3: ใบที่รอเข้าเวร → เวรที่กำลังดู
  async moveRecord(req, body) {
    const ref = db().collection('records').doc(text(body.id, 'รายการ', 60));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, NOT_FOUND);
    const shiftId = text(body.shiftId, 'เวร', 60);
    if (!(await db().collection('shifts').doc(shiftId).get()).exists) throw new HttpError(404, 'ไม่พบเวรนี้');
    await ref.update({ shiftId, updatedAt: Date.now() });
    await audit(req, 'moveRecord', ref.id, { shiftId: snap.data().shiftId ?? null }, { shiftId });
    return { id: ref.id };
  },

  async deleteRecord(req, body) {
    const ref = db().collection('records').doc(text(body.id, 'รายการ', 60));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, NOT_FOUND);
    // V31 trash copy · V33 (WR-DATA-05): copy + delete in one batch
    const b = db().batch();
    b.set(db().collection('trash').doc(), { kind: 'record', shift: null, records: [{ id: ref.id, ...snap.data() }], at: Date.now(), by: `weight-report · ${deviceId(req)}` });
    b.delete(ref);
    await b.commit();
    await audit(req, 'deleteRecord', ref.id, snap.data());
    return { ok: true };
  },

  // กดส่งออก Excel: ตรวจรหัสส่งออกทุกครั้ง (V24 Q3) คืนค่าตั้งค่าที่เก็บไว้ + ค่าเริ่มต้น
  async exportUnlock(req, body) {
    await checkPin(req, body.pin, 'export');
    const snap = await db().collection('settings').doc('export').get();
    return {
      exportToken: signExportToken(Date.now() + EXPORT_TOKEN_TTL_MS),
      settings: snap.exists ? snap.data().settings : null,
      defaults: EXPORT_DEFAULTS,
    };
  },

  async exportSaveSettings(req, body) {
    verifyExportToken(body.exportToken);
    const before = (await db().collection('settings').doc('export').get()).data()?.settings || null;
    const settings = exportSettings(body.settings);
    await db().collection('settings').doc('export').set({ settings, updatedAt: Date.now() });
    if (JSON.stringify(before) !== JSON.stringify(settings)) await audit(req, 'exportSaveSettings', 'export', before, settings);
    return { ok: true };
  },

  async renameImporter(req, body) {
    const shiftId = text(body.shiftId, 'เวร', 60);
    const from = text(body.from, 'ชื่อเดิม');
    const to = text(body.to, 'ชื่อใหม่');
    const recs = (await recordsOf(shiftId)).filter(r => r.importer === from);
    const now = Date.now();
    await commitInChunks(recs.map(r => db().collection('records').doc(r.id)), (b, r) => b.update(r, { importer: to, updatedAt: now }));
    await audit(req, 'renameImporter', shiftId, { importer: from }, { importer: to, renamed: recs.length });
    return { renamed: recs.length };
  },
  // customshub D97 Q8: the team's plate list (customshub team/main/plates, read-only here) — the weighing page checks Gemini's plates
  // against it. Only plate, times used and recent empty weights; no slips. customshub not set up → empty list.
  // V33 (WR-SEC-05): the weighing page has no login (owner's decision), so the list stays public — but only to our own page
  // (Origin), and one read of customshub per 5 minutes per instance, so outside calls cannot burn customshub's read quota.
  async plates(req) {
    if (!originOk(req)) throw new HttpError(403, 'ไม่อนุญาต');
    if (platesCache && Date.now() - platesCache.at < PLATES_TTL_MS) return platesCache.out;
    const { v, note } = await chubRead(async t => (await t.collection('plates').get()).docs.map(d => {
      const p = d.data();
      return { plate: String(p.plate || ''), count: p.count || 0, empties: (p.empties || []).map(e => ({ w: e.w })) };
    }), []);
    const out = { plates: v, note, linked: !!chub() }; // note = customshub could not be read; linked=false = not set up
    if (!note) platesCache = { at: Date.now(), out };
    return out;
  },
};

const PUBLIC_ACTIONS = new Set(['submit', 'login', 'plates']);
const PLATES_TTL_MS = 5 * 60 * 1000;
let platesCache = null;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fn = Object.prototype.hasOwnProperty.call(actions, body.action) && actions[body.action];
    if (!fn) throw new HttpError(400, 'ไม่รู้จักคำสั่งนี้');
    if (!PUBLIC_ACTIONS.has(body.action)) verifyToken(req);
    return res.status(200).json(await fn(req, body));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[summary]', req.body && req.body.action, err);
    // auth: true = token ใช้ไม่ได้ หน้าเว็บต้องขอ PIN ใหม่ (ต่างจาก PIN ผิดตอนยืนยันลบเวร)
    return res.status(status).json({
      error: err instanceof HttpError ? err.message : 'เกิดข้อผิดพลาดในระบบ',
      auth: !!err.auth,
      ...(err.extra || {}),
    });
  }
};
