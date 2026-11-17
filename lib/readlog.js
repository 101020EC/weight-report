// customshub D125 (V38): what Gemini read vs what was saved, kept in weight-ht readlog/{recordId} so customshub's
// Setting › บันทึกการอ่าน AI can show weight-report's reads too. `readDiff` is a copy of customshub src/weight/plates.js readDiff —
// change both together (parity test in customshub).
const norm = (v) => String(v ?? '').replace(/,/g, '').trim();

/** ai = { fields, vehicles: [{plate, empty, gross}] }, final = same shape, fixes = [{ row, from, to }] made by the plate list. */
function readDiff(ai, final, fixes = []) {
  const plateKey = (s) => String(s || '').replace(/[\s\-–.·/]/g, '').toUpperCase();
  const changes = [];
  for (const f of Object.keys({ ...ai.fields, ...final.fields })) {
    if (norm(ai.fields[f]) !== norm(final.fields[f])) changes.push({ row: null, field: f, ai: norm(ai.fields[f]), final: norm(final.fields[f]), how: 'person' });
  }
  const n = Math.max(ai.vehicles.length, final.vehicles.length);
  for (let i = 0; i < n; i++) {
    const a = ai.vehicles[i] || {}, b = final.vehicles[i] || {};
    for (const f of ['plate', 'empty', 'gross']) {
      const fix = f === 'plate' && fixes.find((x) => x.row === i);
      if (fix) {
        changes.push({ row: i, field: f, ai: norm(a[f]), final: norm(b[f]), how: 'plates', kept: plateKey(b[f]) === plateKey(fix.to) });
      } else if (norm(a[f]) !== norm(b[f])) changes.push({ row: i, field: f, ai: norm(a[f]), final: norm(b[f]), how: 'person' });
    }
  }
  return changes;
}

const FIELDS = ['importer', 'goodsType', 'origin', 'declarationNo', 'period', 'dateIso', 'declaredWeight'];
const cut = (v, n = 120) => String(v ?? '').slice(0, n);
/** The page's aiRead → a safe, bounded copy (or null): only known fields, ≤ 50 rows / fixes, short strings. */
function cleanAiRead(x) {
  if (!x || typeof x !== 'object' || !x.fields || !Array.isArray(x.vehicles)) return null;
  return {
    model: cut(x.model, 60),
    fields: Object.fromEntries(FIELDS.map((f) => [f, cut(x.fields[f])])),
    vehicles: x.vehicles.slice(0, 50).map((v) => ({ plate: cut(v?.plate, 40), empty: cut(v?.empty, 20), gross: cut(v?.gross, 20) })),
    fixes: (Array.isArray(x.fixes) ? x.fixes : []).slice(0, 50).map((f) => ({ row: Number(f?.row) || 0, from: cut(f?.from, 40), to: cut(f?.to, 40) })),
    scaleTaps: (Array.isArray(x.scaleTaps) ? x.scaleTaps : []).slice(0, 50).map((t) => ({ row: Number(t?.row) || 0, w: Number(t?.w) || 0 })),
  };
}

/** The read-log document for a saved slip (fields / vehicles = what was saved). */
function readlogDoc(aiRead, { id, fields, vehicles, by, at }) {
  const final = { fields: Object.fromEntries(FIELDS.map((f) => [f, fields[f]])), vehicles: vehicles.map((v) => ({ plate: v.plate, empty: v.empty, gross: v.gross })) };
  const taps = new Map(aiRead.scaleTaps.map((t) => [t.row, t.w]));
  const changes = readDiff(aiRead, final, aiRead.fixes).map((c) => (c.field === 'empty' && taps.get(c.row) === Number(c.final) ? { ...c, how: 'scale' } : c));
  return { at, by, source: 'weight-report', model: aiRead.model, declarationNo: fields.declarationNo, recordId: id, rows: final.vehicles.length, changes, fixes: aiRead.fixes };
}

module.exports = { readDiff, cleanAiRead, readlogDoc };
