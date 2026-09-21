// api/summary.js — เมนูสรุปผล: ข้อมูลอยู่ Firestore (weight-ht) เข้าถึงผ่านฟังก์ชันนี้เท่านั้น
// rules ของ Firestore ปิดหมด (firestore.rules) — ดู GRILL_PLAN_V17.md D1–D4
//
// POST { action, ... }
//   submit            — ส่งใบขนจากหน้าชั่ง (ไม่ต้องใช้ PIN)
//   login { pin }     — ตรวจ PIN คืน token อายุ 15 วัน
//   ที่เหลือต้องมี header  Authorization: Bearer <token>
//   load { shiftId? } · createShift · updateShift { startDate, endDate } · deleteShift { pin } ·
//   createRecord { shiftId } · updateRecord · deleteRecord · renameImporter · recordsByDate { dateIso }

const crypto = require('crypto');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const LOCK_MAX_FAILS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const SHIFT_MAX_DAYS = 7;

let _db = null;
function db() {
  if (_db) return _db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new HttpError(500, 'ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT');
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
  _db = getFirestore();
  return _db;
}

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

function clientKey(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// ตรวจ PIN พร้อมล็อก 15 นาทีเมื่อผิดครบ 8 ครั้ง (PIN มีแค่ 10,000 แบบ)
async function checkPin(req, pin) {
  const expected = pinConfig();
  const ref = db().collection('pin_attempts').doc(clientKey(req));
  const now = Date.now();
  const snap = await ref.get();
  let { fails = 0, windowStart = now } = snap.exists ? snap.data() : {};
  if (now - windowStart > LOCK_WINDOW_MS) { fails = 0; windowStart = now; }
  if (fails >= LOCK_MAX_FAILS) {
    const mins = Math.ceil((windowStart + LOCK_WINDOW_MS - now) / 60000);
    throw new HttpError(429, `ใส่รหัสผิดหลายครั้ง กรุณารอ ${mins} นาที`);
  }
  const a = Buffer.from(String(pin || ''));
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    if (snap.exists) await ref.delete();
    return;
  }
  await ref.set({ fails: fails + 1, windowStart });
  throw new HttpError(401, 'รหัสไม่ถูกต้อง');
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

// เวรล่าสุด = เวรที่เปิดอยู่ ในช่วงวันเริ่มเวร–วันสิ้นสุด (D2)
async function openShift() {
  const snap = await db().collection('shifts').orderBy('createdAt', 'desc').limit(10).get();
  if (snap.empty) return null;
  const today = todayBangkok();
  const shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const active = shifts.find(s => (s.startDate ? today >= s.startDate : true) && today <= s.endDate);
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
  return s && s.exists ? `เวร ${thaiDate(s.data().startDate)} – ${thaiDate(s.data().endDate)}` : 'รายการที่รอเข้าเวร';
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
    return { id: ref.id, shiftId, replaced: !!dup };
  },

  async login(req, body) {
    await checkPin(req, body.pin);
    const exp = Date.now() + TOKEN_TTL_MS;
    return { token: signToken(exp), expiresAt: exp };
  },

  async load(req, body) {
    const shiftsSnap = await db().collection('shifts').orderBy('createdAt', 'desc').limit(200).get();
    const shifts = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const selected = (body.shiftId && shifts.find(s => s.id === body.shiftId)) || shifts[0] || null;
    const pending = await db().collection('records').where('shiftId', '==', null).count().get();
    return {
      today: todayBangkok(),
      shifts,
      shift: selected,
      records: selected ? await recordsOf(selected.id) : [],
      pendingCount: pending.data().count,
    };
  },

  async createShift(req, body) {
    const range = shiftRange(body);
    const ref = db().collection('shifts').doc();
    const now = Date.now();
    await ref.set({ ...range, createdAt: now, updatedAt: now });
    // ใบขนที่ส่งมาตอนยังไม่มีเวรเปิด → เข้าเวรใหม่นี้ (D2)
    const pending = await db().collection('records').where('shiftId', '==', null).get();
    await commitInChunks(pending.docs.map(d => d.ref), (b, r) => b.update(r, { shiftId: ref.id, updatedAt: now }));
    return { id: ref.id, attached: pending.size };
  },

  async updateShift(req, body) {
    const ref = db().collection('shifts').doc(text(body.id, 'เวร', 60));
    const range = shiftRange(body);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'ไม่พบเวรนี้');
    await ref.update({ ...range, updatedAt: Date.now() });
    return { id: ref.id };
  },

  async deleteShift(req, body) {
    await checkPin(req, body.pin);
    const id = text(body.id, 'เวร', 60);
    const recs = await db().collection('records').where('shiftId', '==', id).get();
    await commitInChunks(recs.docs.map(d => d.ref), (b, r) => b.delete(r));
    await db().collection('shifts').doc(id).delete();
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
    if (!snap.exists) throw new HttpError(404, 'ไม่พบรายการนี้');
    await ref.update({ ...recordFields(body), updatedAt: Date.now() });
    return { id: ref.id };
  },

  async deleteRecord(req, body) {
    await db().collection('records').doc(text(body.id, 'รายการ', 60)).delete();
    return { ok: true };
  },

  async renameImporter(req, body) {
    const shiftId = text(body.shiftId, 'เวร', 60);
    const from = text(body.from, 'ชื่อเดิม');
    const to = text(body.to, 'ชื่อใหม่');
    const recs = (await recordsOf(shiftId)).filter(r => r.importer === from);
    const now = Date.now();
    await commitInChunks(recs.map(r => db().collection('records').doc(r.id)), (b, r) => b.update(r, { importer: to, updatedAt: now }));
    return { renamed: recs.length };
  },
};

const PUBLIC_ACTIONS = new Set(['submit', 'login']);

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
