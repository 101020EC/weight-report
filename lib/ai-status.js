// customshub D123 (V37): weight-report's Gemini is set from customshub's Setting › ใบชั่งน้ำหนัก.
// settings/gemini = { model: 'auto' | name, order: [names] | null, labels: { slot: nickname } } — written only by customshub (admin).
// settings/aiStatus = what happened, kept here after each call so customshub's card and bell can show it:
//   { last: {model, at}, fail: {model, used, at} | null, gone: {model: at}, keys: {slot: {tail, quotaAt, quotaModel, badAt}},
//     gday: { day, c: {slot: {model: {ok, q429}}} }, skips: {model: {why, at}}, at }
//   customshub D125: `skips` = why each model was last passed over (q429 · gone · err · slow · empty · bad · other), cleared when it answers.
// Pure functions — test/ai-status.test.js. Same shapes as customshub's own AI card (functions/_lib/gemini.js).

const MODEL_NAME = /^gemini-[a-z0-9][a-z0-9.-]{1,48}$/;
const GONE_KEEP_MS = 7 * 86400e3;

/** Models in the order tried: the chosen one first, then the saved order (or the env override + FREE_MODELS when nothing is saved). */
function orderFrom(settings, freeModels, envModel = '') {
  const s = settings || {};
  const saved = Array.isArray(s.order) ? s.order.filter((m) => MODEL_NAME.test(m)) : [];
  const base = saved.length ? saved : [envModel, ...freeModels];
  const chosen = s.model && s.model !== 'auto' && MODEL_NAME.test(s.model) ? s.model : '';
  return [...new Set([chosen, ...base].map((m) => String(m || '').trim()).filter(Boolean))];
}
const chosenOf = (settings) => (settings?.model && settings.model !== 'auto' && MODEL_NAME.test(settings.model) ? settings.model : '');

/** The day Google's free quota counts in: the date in California. */
function quotaDay(now) {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: 'America/Los_Angeles' });
}

/**
 * The status after one call. info = { modelUsed (or ''), chosen (or ''), events: [{slot, model, kind: 'ok'|'q429'|'bad'}], gone: [models],
 * tails: {slot: last 4 characters} }.
 */
function nextStatus(prev, info, now) {
  const p = prev || {};
  const day = quotaDay(now);
  const gday = p.gday?.day === day ? { day, c: JSON.parse(JSON.stringify(p.gday.c || {})) } : { day, c: {} };
  const keys = { ...(p.keys || {}) };
  for (const [slot, tail] of Object.entries(info.tails || {})) keys[slot] = { ...(keys[slot] || {}), tail };
  for (const e of info.events || []) {
    if (!e.slot) continue;
    if (e.kind === 'bad') { keys[e.slot] = { ...(keys[e.slot] || {}), badAt: now }; continue; }
    if (e.kind !== 'ok' && e.kind !== 'q429') continue; // D125: other skips go to `skips`, not the day's counts
    const m = ((gday.c[e.slot] ||= {})[e.model] ||= { ok: 0, q429: 0 });
    if (e.kind === 'ok') { m.ok += 1; if (keys[e.slot]?.badAt) { keys[e.slot] = { ...keys[e.slot] }; delete keys[e.slot].badAt; } }
    if (e.kind === 'q429') { m.q429 += 1; keys[e.slot] = { ...(keys[e.slot] || {}), quotaAt: now, quotaModel: e.model }; }
  }
  const gone = Object.fromEntries(Object.entries(p.gone || {}).filter(([, at]) => now - at < GONE_KEEP_MS));
  for (const m of info.gone || []) gone[m] = now;
  if (info.modelUsed) delete gone[info.modelUsed];
  let fail = p.fail || null;
  if (!info.chosen) fail = null;
  else if (info.modelUsed === info.chosen) fail = null;
  else if (info.modelUsed) fail = { model: info.chosen, used: info.modelUsed, at: now };
  const last = info.modelUsed ? { model: info.modelUsed, at: now } : (p.last || null);
  const skips = Object.fromEntries(Object.entries(p.skips || {}).filter(([, x]) => now - (x.at || 0) < GONE_KEEP_MS));
  for (const e of info.events || []) {
    if (e.kind === 'ok') delete skips[e.model];
    else if (e.model) skips[e.model] = { why: e.kind, at: now, ...(e.code ? { code: e.code } : {}) };
  }
  return { last, fail, gone, keys, gday, skips, at: now };
}

module.exports = { MODEL_NAME, orderFrom, chosenOf, quotaDay, nextStatus };
