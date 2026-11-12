// api/summary.js + api/notify.js against the in-memory Firestore (test/fake-firestore.js). V32 + V33 (AUDIT-2026-11).
const test = require('node:test');
const assert = require('node:assert/strict');
const { install, call } = require('./fake-firestore.js');

const { main, chub } = install();
const summary = require('../api/summary.js');
const notify = require('../api/notify.js');

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
const slip = (o = {}) => ({ importer: 'ดิเรก', goodsType: 'หอม', origin: 'จีน', declarationNo: 'A018-06909-07124', period: '', dateIso: today, declaredWeight: '44,000', netWeight: '44120', vehicles: [], ...o });
let token;
const api = (action, body = {}, opt = {}) => call(summary, { action, ...body }, { token, ...opt });
const logs = (action) => [...main.store].filter(([k, v]) => k.startsWith('log/') && v.action === action).map(([, v]) => v);

test('login: wrong PIN counts down, right PIN gives a token; counters carry expireAt; old ones are cleaned (WR-DATA-04)', async () => {
  main.store.set('pin_attempts/stale1', { fails: 3, windowStart: Date.now() - 3600e3 });
  const bad = await api('login', { pin: '0000' });
  assert.equal(bad.status, 401); assert.match(bad.body.error, /เหลืออีก/);
  const counters = [...main.store].filter(([k]) => k.startsWith('pin_attempts/summary_'));
  assert.ok(counters.length === 2 && counters.every(([, v]) => v.expireAt instanceof Date));
  assert.equal(main.store.has('pin_attempts/stale1'), false, 'a counter whose window passed long ago is removed');
  const ok = await api('login', { pin: '1234' });
  assert.equal(ok.status, 200); token = ok.body.token;
  assert.equal([...main.store.keys()].filter((k) => k.startsWith('pin_attempts/summary_')).length, 0);
});

test('V32: one store — a customshub-only shift is neither seen nor filed into; submit waits, a new shift takes it in one batch', async () => {
  chub.store.set('team/main/wshifts/hubS', { startDate: today, endDate: today, createdAt: 9e15 });
  const a = await api('submit', slip());
  assert.equal(a.status, 200); assert.equal(a.body.shiftId, null);
  const before = main.stats.batches;
  const sh = await api('createShift', { startDate: today });
  assert.equal(sh.body.attached, 1);
  assert.equal(main.stats.batches - before, 1, 'shift + waiting slip in one batch (WR-DATA-05)');
  const ld = await api('load', {});
  assert.deepEqual([ld.body.shift.id, ld.body.records.map((r) => r.id), 'chubNote' in ld.body], [sh.body.id, [a.body.id], false]);
  assert.equal(logs('submit').length, 1); assert.equal(logs('createShift')[0].after.attached, 1);
});

test('edit: a number another slip already has is refused (WR-DATA-03); the change is logged with before/after (WR-DATA-02)', async () => {
  const sid = (await api('load', {})).body.shift.id;
  const b = await api('createRecord', { ...slip({ declarationNo: 'B-2' }), shiftId: sid });
  assert.equal(b.status, 200);
  const clash = await api('updateRecord', { id: b.body.id, ...slip() }); // A018-06909-07124 is the first slip
  assert.equal(clash.status, 409); assert.match(clash.body.error, /มีอยู่แล้ว/);
  const same = await api('updateRecord', { id: b.body.id, ...slip({ declarationNo: 'B-2', netWeight: '43000' }) }); // its own number
  assert.equal(same.status, 200);
  const [l] = logs('updateRecord');
  assert.deepEqual([l.id, l.before.netWeight, l.after.netWeight, l.by, typeof l.ip], [b.body.id, 44120, 43000, 'weight-report · device-0001', 'string']);
  assert.equal('vehicles' in l.before, false);
});

test('delete a slip and a shift: trash copy + delete in one batch each (WR-DATA-05), logged', async () => {
  const st = (await api('load', {})).body;
  const one = st.records.find((r) => r.declarationNo === 'B-2');
  let n = main.stats.batches;
  assert.equal((await api('deleteRecord', { id: one.id })).status, 200);
  assert.equal(main.stats.batches - n, 1);
  assert.equal(main.store.has(`records/${one.id}`), false);
  n = main.stats.batches;
  const del = await api('deleteShift', { id: st.shift.id, pin: '1234' });
  assert.deepEqual([del.status, del.body.deletedRecords, main.stats.batches - n], [200, 1, 1]);
  const trash = [...main.store].filter(([k]) => k.startsWith('trash/')).map(([, v]) => v.kind).sort();
  assert.deepEqual(trash, ['record', 'shift']);
  assert.deepEqual([logs('deleteRecord').length, logs('deleteShift').length], [1, 1]);
  assert.equal((await api('deleteShift', { id: 'hubS', pin: '1234' })).status, 404, 'a customshub shift id is not ours');
});

test('plates (WR-SEC-05): only from our page; customshub read at most once per 5 minutes', async () => {
  chub.store.set('team/main/plates/p1', { plate: '71-5778', count: 3, empties: [{ w: 9840, at: 1 }] });
  assert.equal((await api('plates', {}, { origin: null })).status, 403);
  assert.equal((await api('plates', {}, { origin: 'https://evil.example' })).status, 403);
  const p = await api('plates');
  assert.deepEqual([p.status, p.body.plates[0].plate, p.body.plates[0].empties, p.body.linked], [200, '71-5778', [{ w: 9840 }], true]);
  chub.store.set('team/main/plates/p2', { plate: '70-1216', count: 1, empties: [] });
  assert.equal((await api('plates')).body.plates.length, 1, 'cached');
});

test('notify (WR-SEC-04): our Origin only, fields capped, at most 120 an hour per address', async () => {
  const sent = [];
  const real = global.fetch;
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body).text); return new Response('{}'); };
  process.env.TELEGRAM_BOT_TOKEN = 't'; process.env.TELEGRAM_CHAT_ID = 'c';
  try {
    const body = { action: 'report_created', declaration_no: 'A1', importer: 'x'.repeat(500), date: today, goods_type: 'หอม', plates: '71-1', diff_text: '+5 KG' };
    assert.equal((await call(notify, body, { origin: null })).status, 403, 'no Origin = not our page');
    assert.equal((await call(notify, body, { origin: 'https://evil.example' })).status, 403);
    const ok = await call(notify, body, { ip: '2.2.2.2' });
    assert.equal(ok.status, 200);
    assert.ok(sent[0].includes('x'.repeat(80)) && !sent[0].includes('x'.repeat(81)), 'importer capped at 80');
    for (let i = 1; i < 120; i++) await call(notify, body, { ip: '2.2.2.2' });
    assert.equal((await call(notify, body, { ip: '2.2.2.2' })).status, 429);
    assert.equal((await call(notify, body, { ip: '3.3.3.3' })).status, 200, 'another address is not affected');
    assert.equal((await call(notify, { action: 'nope' })).status, 400);
  } finally { global.fetch = real; }
});
