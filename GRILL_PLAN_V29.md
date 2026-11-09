# V29 — plate check from customshub's plate list (2026-11-09)

Decided in customshub PLAN.md D97 (Q4–Q8). The team's plate list lives in customshub `team/main/plates` (plate, times used, last 5 empty weights).
customshub keeps it up to date, including slips saved here (it catches up from this app's `records` by `updatedAt`). This app only reads it.

- `api/summary.js` action `plates` — public (the weighing page has no PIN), read-only through `CUSTOMSHUB_SERVICE_ACCOUNT`; returns plate, count and empty weights only.
- `index.html` (block at the end): after a Gemini read, a plate one character off exactly one known plate — or up to two off with that truck's empty weight — is
  corrected silently; known plate + its own empty weight → both boxes green (screen only, the report image is unchanged); known plate with another empty weight →
  a character-sized yellow "!" in the corner, tap the cell → "ครั้งก่อน …", tap to use it. Rows never change height. Plate boxes suggest known plates.
- The rules are a copy of customshub `src/weight/plates.js` `checkRow` — change both together.
- Not built here: the edit log (customshub `readlog`) — this app cannot write to customshub.

- **LIVE 2026-11-09** (8198c6d + read-status follow-up). /api/summary plates → linked:true, note:null, 0 plates (customshub seeds on the first open of its ใบชั่ง).
