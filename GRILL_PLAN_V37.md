# V37 — Gemini model / order set from customshub (2026-11-17)

Decided in customshub PLAN.md D123 (Q1, Q3, Q7). customshub's admin sets this site's Gemini in Setting › ใบชั่งน้ำหนัก › Gemini ของ weight-report.

- `settings/gemini` (written only by customshub through its own server) = { model: 'auto' | name, order: [names] | null, labels }.
  `api/gemini.js` reads it once a minute per instance: the chosen model first, then the saved order, or `GEMINI_MODEL` env + FREE_MODELS when
  nothing is saved. Unreadable → as before.
- `settings/aiStatus` after every call (transaction): last model, a chosen model that did not answer, gone models (404, kept a week), per key
  slot the last 4 characters / last quota-out / refused, and ok / 429 counts per model for the California day. customshub's card and bell read it.
- Pure parts in `lib/ai-status.js` (test/ai-status.test.js); the Telegram gone-model alert stays and now points to customshub.

- **BUILT 2026-11-17, not committed / not pushed** (push main = deploy). Ship together with V36, after customshub's deploy.
