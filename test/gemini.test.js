// api/gemini.js — V33 (AUDIT-2026-11 WR-SEC-08/09): key in a header, plain messages to the page, no slip data or address in logs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { install, call } = require('./fake-firestore.js');

install();
process.env.GEMINI_API_KEY_1 = 'KEY-ONE-SECRET';
const gemini = require('../api/gemini.js');
const img = { mimeType: 'image/jpeg', data: 'AAAA' };

async function run(reply, fn) {
  const seen = []; const logged = [];
  const real = { fetch: global.fetch, log: console.log, warn: console.warn, error: console.error };
  global.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) return new Response('{}');
    seen.push({ url: String(url), key: init.headers['x-goog-api-key'] });
    return reply();
  };
  for (const k of ['log', 'warn', 'error']) console[k] = (...a) => logged.push(a.join(' '));
  try { return await fn(seen, logged); } finally { global.fetch = real.fetch; Object.assign(console, { log: real.log, warn: real.warn, error: real.error }); }
}

test('the key goes in x-goog-api-key, never in the URL; a read slip logs neither its number, importer nor the address', async () => {
  const text = JSON.stringify({ declaration_no: 'A018-06909-07124', importer: 'ดิเรก', date: '12/11/2569', declared_weight: '44,000', vehicles: [] });
  await run(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })), async (seen, logged) => {
    const r = await call(gemini, { type: 'weight', images: [img] }, { ip: '9.8.7.6' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.data.declaration_no, r.body.data.declared_weight], ['A018-06909-07124', 44000]); // the page still gets it
    assert.ok(seen.length >= 1 && seen.every((s) => s.key === 'KEY-ONE-SECRET' && !s.url.includes('key=') && !s.url.includes('SECRET')));
    const all = logged.join('\n');
    assert.doesNotMatch(all, /A018-06909-07124|ดิเรก|9\.8\.7\.6|SECRET/);
    assert.match(all, /ip#[0-9a-f]{8}/);
  });
});

test("Google's own error text stays out of the reply; quota keeps its Thai message", async () => {
  await run(() => new Response(JSON.stringify({ error: { message: 'Internal details from Google: backend shard 42 failed' } }), { status: 500 }), async () => {
    const r = await call(gemini, { type: 'weight', images: [img] });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'AI อ่านไม่สำเร็จ ลองใหม่หรือกด Manual');
  });
  await run(() => new Response(JSON.stringify({ error: { message: 'Invalid image: bad base64 at offset 3' } }), { status: 400 }), async () => {
    const r = await call(gemini, { type: 'weight', images: [img] });
    assert.deepEqual([r.status, r.body.error], [400, 'อ่านรูปนี้ไม่ได้ ลองถ่ายใหม่หรือกด Manual']);
  });
  await run(() => new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED' } }), { status: 429 }), async () => {
    const r = await call(gemini, { type: 'weight', images: [img] });
    assert.deepEqual([r.status, r.body.quota, /โควตา/.test(r.body.error)], [429, true, true]);
  });
});
