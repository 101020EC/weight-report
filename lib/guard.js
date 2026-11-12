// lib/guard.js — shared checks for the public endpoints (V33, AUDIT-2026-11 WR-SEC-04/05/09).
// The weighing page stays open without login (owner's decision on WR-SEC-01/03), so these do not authenticate; they keep
// other sites and scripts from using our endpoints casually and cap how often one address can.
const crypto = require('crypto');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ALLOWED_ORIGINS = ['https://weight-report.vercel.app'];

// browsers send Origin on every POST (same-origin too); a request without it is not from our page
function originOk(req) {
  const o = String(req.headers.origin || '');
  return ALLOWED_ORIGINS.includes(o) || (process.env.VERCEL_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(o));
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}
// logs keep a short hash of the address, never the address or business data (WR-SEC-09)
const ipTag = req => crypto.createHash('sha256').update(`ip|${clientIp(req)}`).digest('hex').slice(0, 8);

let _db = null;
function db() {
  if (_db) return _db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp({ credential: cert(JSON.parse(raw)) });
  return (_db = getFirestore(app));
}

// at most `max` calls per `windowMs` from one address for `kind` (rate/{kind}_{hash}); no database = no limit.
// Returns true when allowed. A read failure lets the call through — the limit must never stop the team's own work.
async function rateOk(req, kind, max, windowMs) {
  const d = db();
  if (!d) return true;
  const ref = d.collection('rate').doc(`${kind}_${crypto.createHash('sha256').update(`${kind}|${clientIp(req)}`).digest('hex').slice(0, 32)}`);
  try {
    const now = Date.now();
    const snap = await ref.get();
    let { count = 0, windowStart = now } = snap.exists ? snap.data() : {};
    if (now - windowStart > windowMs) { count = 0; windowStart = now; }
    if (count >= max) return false;
    await ref.set({ count: count + 1, windowStart, expireAt: new Date(windowStart + windowMs) });
    return true;
  } catch (e) {
    console.warn('[rate]', kind, e.message);
    return true;
  }
}

module.exports = { ALLOWED_ORIGINS, originOk, clientIp, ipTag, db, rateOk };
