# V38 — why a Gemini model was skipped + AI read log (2026-11-17)

Decided in customshub PLAN.md D125 (Q1, Q4).

- api/gemini.js: every model passed over is recorded with why (q429 · gone · err + code · slow · empty · bad · other) in
  settings/aiStatus.skips (lib/ai-status.js); customshub's card says "เลือก 3.6-flash ไว้แต่ใช้ไม่ได้ (ตอบช้าเกิน 25 วินาที)". A 400 that names
  thinking → the same model once without thinkingConfig (as customshub D57), instead of failing the read.
- Read log: the page keeps what Gemini read (fields + rows), the model, the plate list's fixes and scale taps, and sends it with the save
  (`aiRead`); api/summary writes `readlog/{recordId}` (lib/readlog.js — `readDiff` is a copy of customshub's, keep them equal). Slips typed by
  hand leave no row. customshub's Setting › บันทึกการอ่าน AI shows these next to Hub's.

- **BUILT 2026-11-17, not committed / not pushed.** Tests 16.
