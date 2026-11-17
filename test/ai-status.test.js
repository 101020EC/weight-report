// customshub D123 (V37): weight-report's Gemini settings from customshub + the status it keeps for customshub's card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { orderFrom, chosenOf, nextStatus, quotaDay } = require('../lib/ai-status.js');

const FREE = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];

test('order: nothing saved → env override + FREE_MODELS; saved order replaces both; chosen model goes first', () => {
  assert.deepEqual(orderFrom(null, FREE, ''), FREE);
  assert.deepEqual(orderFrom(null, FREE, 'gemini-9-flash'), ['gemini-9-flash', ...FREE]);
  assert.deepEqual(orderFrom({ model: 'auto', order: ['gemini-2.5-flash', 'gemini-3.6-flash'] }, FREE, 'gemini-9-flash'), ['gemini-2.5-flash', 'gemini-3.6-flash']);
  assert.deepEqual(orderFrom({ model: 'gemini-3.8-flash', order: null }, FREE), ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']);
  assert.deepEqual(orderFrom({ model: 'bad name', order: ['x', 'gemini-2.5-flash'] }, FREE), ['gemini-2.5-flash'], 'bad names are dropped');
  assert.equal(chosenOf({ model: 'auto' }), '');
  assert.equal(chosenOf({ model: 'gemini-3.8-flash' }), 'gemini-3.8-flash');
});

test('status: counts per key and model for the California day, quota and bad keys, gone models, last model', () => {
  const t0 = Date.parse('2026-11-17T05:00:00Z');
  let s = nextStatus(null, { modelUsed: 'gemini-3.8-flash', chosen: '', tails: { GEMINI_API_KEY_1: 'ab12' },
    events: [{ slot: 'GEMINI_API_KEY_1', model: 'gemini-3.6-flash', kind: 'q429' }, { slot: 'GEMINI_API_KEY_1', model: 'gemini-3.8-flash', kind: 'ok' }],
    gone: ['gemini-2.0-flash'] }, t0);
  assert.deepEqual(s.last, { model: 'gemini-3.8-flash', at: t0 });
  assert.deepEqual(s.keys.GEMINI_API_KEY_1, { tail: 'ab12', quotaAt: t0, quotaModel: 'gemini-3.6-flash' });
  assert.deepEqual(s.gday, { day: quotaDay(t0), c: { GEMINI_API_KEY_1: { 'gemini-3.6-flash': { ok: 0, q429: 1 }, 'gemini-3.8-flash': { ok: 1, q429: 0 } } } });
  assert.deepEqual(s.gone, { 'gemini-2.0-flash': t0 });
  assert.equal(s.fail, null);
  s = nextStatus(s, { modelUsed: 'gemini-3.8-flash', chosen: '', events: [{ slot: 'GEMINI_API_KEY_1', model: 'gemini-3.8-flash', kind: 'ok' }] }, t0 + 60e3);
  assert.equal(s.gday.c.GEMINI_API_KEY_1['gemini-3.8-flash'].ok, 2);
  const nextDay = t0 + 86400e3;
  s = nextStatus(s, { modelUsed: 'gemini-3.6-flash', events: [{ slot: 'GEMINI_API_KEY_2', model: 'gemini-3.6-flash', kind: 'bad' }] }, nextDay);
  assert.deepEqual(s.gday.c, {}, 'a new quota day starts the counts again');
  assert.equal(s.keys.GEMINI_API_KEY_2.badAt, nextDay);
  assert.equal(s.keys.GEMINI_API_KEY_1.quotaAt, t0, 'last quota time stays');
  s = nextStatus(s, { modelUsed: 'gemini-2.0-flash', events: [] }, nextDay + 1);
  assert.deepEqual(s.gone, {}, 'a model that answers again is no longer gone');
  s = nextStatus({ gone: { old: t0 } }, { events: [] }, t0 + 8 * 86400e3);
  assert.deepEqual(s.gone, {}, 'gone entries older than a week fall off');
});

test('status: a chosen model that did not answer is a failure until it answers again', () => {
  let s = nextStatus(null, { modelUsed: 'gemini-3.6-flash', chosen: 'gemini-9-flash', events: [] }, 1);
  assert.deepEqual(s.fail, { model: 'gemini-9-flash', used: 'gemini-3.6-flash', at: 1 });
  s = nextStatus(s, { modelUsed: '', chosen: 'gemini-9-flash', events: [] }, 2);
  assert.deepEqual(s.fail.at, 1, 'a call where nothing answered keeps the last failure');
  s = nextStatus(s, { modelUsed: 'gemini-9-flash', chosen: 'gemini-9-flash', events: [] }, 3);
  assert.equal(s.fail, null);
  assert.equal(nextStatus({ fail: { model: 'x' } }, { modelUsed: 'gemini-3.6-flash', chosen: '' }, 4).fail, null, 'back to auto clears it');
});

test('D125: skips keep why a model was passed over, until it answers again', () => {
  let s = nextStatus(null, { modelUsed: 'gemini-2.5-flash', chosen: 'gemini-3.6-flash',
    events: [{ slot: 'A', model: 'gemini-3.6-flash', kind: 'slow' }, { slot: 'A', model: 'gemini-3.8-flash', kind: 'err', code: 503 }, { slot: 'A', model: 'gemini-2.5-flash', kind: 'ok' }] }, 10);
  assert.deepEqual(s.skips, { 'gemini-3.6-flash': { why: 'slow', at: 10 }, 'gemini-3.8-flash': { why: 'err', at: 10, code: 503 } });
  assert.deepEqual(s.fail, { model: 'gemini-3.6-flash', used: 'gemini-2.5-flash', at: 10 });
  s = nextStatus(s, { modelUsed: 'gemini-3.6-flash', chosen: 'gemini-3.6-flash', events: [{ slot: 'A', model: 'gemini-3.6-flash', kind: 'ok' }] }, 20);
  assert.deepEqual(Object.keys(s.skips), ['gemini-3.8-flash']);
  assert.equal(s.fail, null);
});

test('D127: a model that failed in the last 30 min rests at the end; quota (per key) does not count', () => {
  const { coolOrder } = require('../lib/ai-status.js');
  const now = 10 * 3600e3;
  const order = ['gemini-4-hydrogen', 'gemini-3.6-flash', 'gemini-2.5-flash'];
  assert.deepEqual(coolOrder(order, { 'gemini-4-hydrogen': { why: 'slow', at: now - 60e3 } }, now), ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-4-hydrogen']);
  assert.deepEqual(coolOrder(order, { 'gemini-4-hydrogen': { why: 'slow', at: now - 31 * 60e3 } }, now), order, 'after 30 min it is first again');
  assert.deepEqual(coolOrder(order, { 'gemini-4-hydrogen': { why: 'q429', at: now } }, now), order);
  assert.deepEqual(coolOrder(order, { 'gemini-4-hydrogen': { why: 'err', at: now }, 'gemini-3.6-flash': { why: 'gone', at: now } }, now), ['gemini-2.5-flash', 'gemini-4-hydrogen', 'gemini-3.6-flash']);
});
