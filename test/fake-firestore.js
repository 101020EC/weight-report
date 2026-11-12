// A small in-memory stand-in for firebase-admin's Firestore, installed before api/* is required (no network, no emulator).
const Module = require('module');

function makeDb() {
  const store = new Map(); // "col/id" -> data
  let auto = 0;
  const stats = { batches: 0 };
  const docRef = (col, id) => {
    const key = `${col}/${id}`;
    const ref = {
      id, path: key,
      get: async () => { const d = store.has(key) ? structuredClone(store.get(key)) : undefined; return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)), ref }; }, // a snapshot is fixed when read
      collection: (name) => collection(`${key}/${name}`),
      set: async (d, o) => { store.set(key, o && o.merge ? { ...(store.get(key) || {}), ...d } : { ...d }); },
      update: async (d) => { if (!store.has(key)) throw new Error(`NOT_FOUND ${key}`); store.set(key, { ...store.get(key), ...d }); },
      create: async (d) => { if (store.has(key)) throw new Error(`ALREADY_EXISTS ${key}`); store.set(key, { ...d }); },
      delete: async () => { store.delete(key); },
    };
    return ref;
  };
  const cmp = { '==': (a, b) => (a ?? null) === b, '<': (a, b) => a < b, '>': (a, b) => a > b, in: (a, b) => b.includes(a) };
  const query = (col, filters = [], order = null, lim = null) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]], order, lim),
    orderBy: (f, dir) => query(col, filters, [f, dir], lim),
    limit: (n) => query(col, filters, order, n),
    get: async () => {
      let rows = [...store.entries()].filter(([k]) => k.startsWith(`${col}/`) && !k.slice(col.length + 1).includes('/'))
        .map(([k, d]) => ({ id: k.slice(col.length + 1), d }));
      for (const [f, op, v] of filters) rows = rows.filter((x) => cmp[op](x.d[f], v));
      if (order) rows.sort((a, b) => (order[1] === 'desc' ? -1 : 1) * ((a.d[order[0]] || 0) - (b.d[order[0]] || 0)));
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map((x) => ({ id: x.id, exists: true, data: () => structuredClone(x.d), ref: docRef(col, x.id) }));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  function collection(col) { return { ...query(col), doc: (id) => docRef(col, id || `auto${String(++auto).padStart(4, '0')}`) }; }
  const db = {
    store, stats, collection,
    batch: () => {
      const ops = [];
      return {
        set: (r, d) => ops.push(() => r.set(d)), update: (r, d) => ops.push(() => r.update(d)),
        create: (r, d) => ops.push(() => r.create(d)), delete: (r) => ops.push(() => r.delete()),
        commit: async () => {
          stats.batches++;
          const snapshot = new Map(store);
          try { for (const o of ops) await o(); } catch (e) { store.clear(); snapshot.forEach((v, k) => store.set(k, v)); throw e; } // all or nothing
        },
      };
    },
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o) }),
  };
  return db;
}

/** Install fake firebase-admin: the default app gets `main`, an app named 'chub' (customshub) gets `chub`. */
function install() {
  const main = makeDb();
  const chub = makeDb();
  const apps = [];
  const real = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'firebase-admin/app') return { initializeApp: (o, name = '[DEFAULT]') => { const a = { name }; apps.push(a); return a; }, cert: (x) => x, getApps: () => apps };
    if (req === 'firebase-admin/firestore') return { getFirestore: (app) => ((app || { name: '[DEFAULT]' }).name === 'chub' ? chub : main) };
    return real.call(this, req, ...rest);
  };
  process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"test"}';
  process.env.CUSTOMSHUB_SERVICE_ACCOUNT = '{"project_id":"chub"}';
  process.env.SUMMARY_PIN = '1234';
  process.env.EXPORT_PIN = '5678';
  return { main, chub };
}

/** Call a Vercel-style handler → {status, body}. */
async function call(handler, body, { token, origin = 'https://weight-report.vercel.app', ip = '1.1.1.1', device = 'device-0001' } = {}) {
  let status = 200; let out; const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, status(s) { status = s; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  const h = { 'x-forwarded-for': ip, 'x-device-id': device };
  if (origin) h.origin = origin;
  if (token) h.authorization = `Bearer ${token}`;
  await handler({ method: 'POST', body, headers: h, socket: {} }, res);
  return { status, body: out, headers };
}

module.exports = { install, call };
