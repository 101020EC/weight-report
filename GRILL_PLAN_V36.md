# V36 — scale empty weights from customshub (2026-11-17)

Decided in customshub PLAN.md D122 (Q1–Q8). The admin imports trucks weighed empty on the scale into customshub `team/main/plates/{id}.scale`.

- `api/summary.js` action `plates` also returns `scale: [{ w, d }]` (weight + date only; type and photo name stay in customshub).
- `index.html` (block at the end): a truck with scale weights is green only within ±100 kg of one; otherwise a red "!" — even when the slip
  matches earlier slips. Tap → "ชั่งจริง 12,540 กก. (5 พ.ย. 69)" first, "ครั้งก่อน …" under it when that is a different number; tap a line to use it.
  The plate fix by weight also accepts a scale weighing within ±100 kg. Trucks without scale weights: V29 unchanged.
- The rules are a copy of customshub `src/weight/plates.js` `checkRow` — change both together (parity checked on 12 cases).
- No import or edit here: the plate list stays read-only in this app.

- **BUILT 2026-11-17, not committed / not pushed** (push main = deploy). Deploy after customshub's rules + Pages.
