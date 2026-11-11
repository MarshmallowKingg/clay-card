// Clay Card — pure scoring logic. No DOM, no storage: shared by the app and the tests.

export const MAX_SHOOTERS = 15;
export const KILL = 'X';
export const LOST = 'O';

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Build a stand list: `count` stands of `targets` targets each, shown in pairs by default. */
export function makeStands(count, targets = 10, pairs = true) {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, targets, pairs }));
}

/** 6 stands: five of 8 and one of 10. `tenAt` is the stand number (1–6) that has 10. */
export function sixStandLayout(tenAt = 6) {
  return makeStands(6, 8).map((s) => (s.n === tenAt ? { ...s, targets: 10 } : s));
}

/** The club's standard layouts. */
export const LAYOUTS = [
  { id: '5x10', label: '5 stands × 10', short: '50 · 5×10', build: () => makeStands(5, 10) },
  { id: '6mixed', label: '6 stands: 5×8 + 1×10', short: '50 · 6 stands', build: (tenAt) => sixStandLayout(tenAt) },
];

/** Which club layout a stand list matches, if any: { id, tenAt? } or null. */
export function detectLayout(stands) {
  const t = stands.map((s) => s.targets);
  if (t.length === 5 && t.every((x) => x === 10)) return { id: '5x10' };
  if (t.length === 6 && t.filter((x) => x === 8).length === 5 && t.includes(10)) return { id: '6mixed', tenAt: t.indexOf(10) + 1 };
  return null;
}

export function newCard({ date = today(), ground = '', shoot = '', scorer = '', shooters = [], stands = makeStands(5, 10), rotate = true } = {}) {
  if (shooters.length > MAX_SHOOTERS) throw new Error(`Max ${MAX_SHOOTERS} shooters`);
  const card = {
    id: uid(), v: 1, discipline: 'English Sporting',
    date, ground, shoot, scorer, rotate,
    shooters: shooters.map((s) => (typeof s === 'string' ? { id: uid(), name: s.trim(), memberNo: '' } : { memberNo: '', ...s, id: s.id || uid() })),
    stands, marks: {},
    createdAt: Date.now(), updatedAt: Date.now(), submittedAt: null, submittedHash: null,
  };
  card.shooters.forEach((s) => ensureMarks(card, s.id));
  return card;
}

/** Make sure a shooter has an array of the right length for every stand (handles stand edits). */
export function ensureMarks(card, sid) {
  const m = (card.marks[sid] ||= []);
  card.stands.forEach((st, i) => {
    const row = (m[i] ||= []);
    row.length = st.targets;
    for (let t = 0; t < st.targets; t++) if (row[t] === undefined) row[t] = null;
  });
  m.length = card.stands.length;
  return m;
}

export function addShooter(card, name, memberNo = '') {
  if (card.shooters.length >= MAX_SHOOTERS) throw new Error(`Max ${MAX_SHOOTERS} shooters`);
  name = String(name).trim();
  memberNo = String(memberNo || '').trim();
  if (!name) throw new Error('Enter a name');
  const dupe = card.shooters.find((x) => (memberNo && x.memberNo === memberNo) || (!memberNo && !x.memberNo && x.name.toLowerCase() === name.toLowerCase()));
  if (dupe) throw new Error(`${dupe.name} is already on this card`);
  const s = { id: uid(), name, memberNo };
  card.shooters.push(s);
  ensureMarks(card, s.id);
  return touch(card);
}

export function removeShooter(card, sid) {
  card.shooters = card.shooters.filter((s) => s.id !== sid);
  delete card.marks[sid];
  return touch(card);
}

export function setStands(card, stands) {
  card.stands = stands.map((s, i) => ({ ...s, n: i + 1 }));
  card.shooters.forEach((s) => ensureMarks(card, s.id));
  return touch(card);
}

/**
 * Shooting order on a stand. With rotation on, whoever shot last on the previous stand
 * shoots first on the next one: A B C D → D A B C → C D A B …
 */
export function shooterOrder(card, standIdx) {
  const list = card.shooters;
  if (!card.rotate || list.length === 0) return list.slice();
  const n = list.length;
  const k = (n - (standIdx % n)) % n;
  return list.slice(k).concat(list.slice(0, k));
}

/** Tap cycle: empty → X (kill) → O (lost) → empty. */
export function cycleMark(card, sid, standIdx, t) {
  const row = ensureMarks(card, sid)[standIdx];
  row[t] = row[t] === null ? KILL : row[t] === KILL ? LOST : null;
  return touch(card);
}

export function setMark(card, sid, standIdx, t, value) {
  ensureMarks(card, sid)[standIdx][t] = value;
  return touch(card);
}

/** Fill every remaining empty box on this stand with a kill. */
export function restKilled(card, sid, standIdx) {
  const row = ensureMarks(card, sid)[standIdx];
  for (let t = 0; t < row.length; t++) if (row[t] === null) row[t] = KILL;
  return touch(card);
}

export function clearStand(card, sid, standIdx) {
  ensureMarks(card, sid)[standIdx].fill(null);
  return touch(card);
}

export function standScore(card, sid, standIdx) {
  const row = (card.marks[sid] || [])[standIdx] || [];
  let kills = 0, shot = 0;
  for (const m of row) { if (m) shot++; if (m === KILL) kills++; }
  return { kills, shot, of: card.stands[standIdx]?.targets ?? row.length };
}

export function shooterTotals(card, sid) {
  const stands = card.stands.map((_, i) => standScore(card, sid, i));
  const total = stands.reduce((a, s) => a + s.kills, 0);
  const shot = stands.reduce((a, s) => a + s.shot, 0);
  const of = stands.reduce((a, s) => a + s.of, 0);
  return { total, shot, of, pct: shot ? Math.round((total / shot) * 1000) / 10 : 0, standScores: stands.map((s) => s.kills) };
}

export function isStandComplete(card, standIdx) {
  return card.shooters.length > 0 && card.shooters.every((s) => standScore(card, s.id, standIdx).shot === card.stands[standIdx].targets);
}

export function isComplete(card) {
  return card.stands.every((_, i) => isStandComplete(card, i));
}

export function targetCount(card) {
  return card.stands.reduce((a, s) => a + s.targets, 0);
}

/**
 * Countback: higher total wins; ties are split on the last stand, then the one before, and so on.
 * Rows still level after countback share a position (shown "=").
 * rows: [{ name, total, standScores: number[] , ...anything }]
 */
export function compareCountback(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  const n = Math.max(a.standScores.length, b.standScores.length);
  for (let i = n - 1; i >= 0; i--) {
    const d = (b.standScores[i] || 0) - (a.standScores[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function leaderboard(rows) {
  const sorted = rows.slice().sort((a, b) => compareCountback(a, b) || a.name.localeCompare(b.name));
  let pos = 0;
  return sorted.map((r, i) => {
    const tiedWithPrev = i > 0 && compareCountback(sorted[i - 1], r) === 0;
    if (!tiedWithPrev) pos = i + 1;
    const tiedWithNext = i < sorted.length - 1 && compareCountback(r, sorted[i + 1]) === 0;
    const onTotalOnly = i > 0 && sorted[i - 1].total === r.total && !tiedWithPrev;
    return { ...r, pos, posLabel: tiedWithPrev || tiedWithNext ? `=${pos}` : String(pos), countback: onTotalOnly };
  });
}

export function cardLeaderboard(card) {
  return leaderboard(card.shooters.map((s) => ({ id: s.id, name: s.name, memberNo: s.memberNo || '', ...shooterTotals(card, s.id) })));
}

/* ---------- Export ---------- */

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(card) {
  const head = ['Pos', 'Name', 'Member no', ...card.stands.map((s) => `S${s.n}`), 'Total', 'Out of', '%', 'Date', 'Ground', 'Shoot', 'Scorer'];
  const lines = [head];
  for (const r of cardLeaderboard(card)) {
    lines.push([r.posLabel, r.name, r.memberNo || '', ...r.standScores, r.total, r.of, r.pct, card.date, card.ground, card.shoot, card.scorer]);
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\n');
}

export function toWhatsApp(card) {
  const title = [card.shoot || 'English Sporting', card.ground].filter(Boolean).join(' – ');
  const out = [`*${title}*`, `${formatDate(card.date)} · ${targetCount(card)} targets`, ''];
  for (const r of cardLeaderboard(card)) {
    out.push(`${r.posLabel}. ${r.name} — *${r.total}*/${r.of}${r.countback ? ' (cb)' : ''}`);
  }
  if (!isComplete(card)) out.push('', '_Card not complete yet_');
  if (card.scorer) out.push('', `Scored by ${card.scorer} · Clay Card`);
  return out.join('\n');
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------- Club submission ---------- */

/** One row per shooter, ready for the Google Sheet. */
export function toSubmission(card) {
  return {
    cardId: card.id, date: card.date, ground: card.ground, shoot: card.shoot, scorer: card.scorer,
    stands: card.stands.map((s) => s.targets),
    shooters: card.shooters.map((s) => {
      const t = shooterTotals(card, s.id);
      return {
        name: s.name, memberNo: s.memberNo || '', total: t.total, of: t.of, pct: t.pct, standScores: t.standScores,
        marks: card.marks[s.id].map((row) => row.map((m) => m || '-').join('')).join(' '),
      };
    }),
  };
}

/** Cheap content hash so the app knows whether a card changed since it was last submitted. */
export function hashCard(card) {
  const s = JSON.stringify([card.date, card.ground, card.shoot, card.scorer, card.shooters, card.stands, card.marks]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function submissionState(card) {
  if (!card.submittedHash) return 'not-submitted';
  return card.submittedHash === hashCard(card) ? 'submitted' : 'changed';
}

/* ---------- Individual history ---------- */

/** Stable identity for a person: membership number if they have one, otherwise their name. */
export function personKey(p) {
  const m = String(p.memberNo || '').trim();
  return m ? `m:${m}` : `n:${String(p.name || '').trim().toLowerCase()}`;
}

/** Everyone who appears on these cards, plus any extra people (e.g. club members), one entry per key. */
export function people(cards, extra = []) {
  const map = new Map();
  for (const p of extra) map.set(personKey(p), { name: p.name, memberNo: p.memberNo || '' });
  for (const c of [...cards].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    for (const s of c.shooters) map.set(personKey(s), { name: s.name, memberNo: s.memberNo || '' });
  }
  return [...map.entries()].map(([key, p]) => ({ key, ...p })).sort((a, b) => a.name.localeCompare(b.name));
}

/** One person's scores from the cards on this phone (only cards where they shot at least one target). */
export function personHistory(cards, key) {
  const out = [];
  for (const c of cards) {
    const s = c.shooters.find((x) => personKey(x) === key);
    if (!s) continue;
    const t = shooterTotals(c, s.id);
    if (!t.shot) continue;
    out.push({ cardId: c.id, date: c.date, shoot: c.shoot, ground: c.ground, total: t.total, shot: t.shot, of: t.of, pct: t.pct, standScores: t.standScores, source: 'phone' });
  }
  return out.sort(byDate);
}

/** Merge this phone's history with the club's, one entry per card (the phone's copy wins). */
export function mergeHistory(local, remote = []) {
  const seen = new Set(local.map((e) => e.cardId));
  const extra = remote.filter((e) => !seen.has(e.cardId)).map((e) => ({ shot: e.of, ...e, source: 'club' }));
  return [...local, ...extra].sort(byDate);
}

/** Summary stats; percentages are of targets shot, so part-cards stay comparable. */
export function historyStats(entries) {
  const list = entries.filter((e) => e.shot > 0);
  if (!list.length) return { shoots: 0 };
  const pct = (es) => {
    const shot = es.reduce((a, e) => a + e.shot, 0);
    return shot ? Math.round((es.reduce((a, e) => a + e.total, 0) / shot) * 1000) / 10 : 0;
  };
  const last5 = list.slice(-5);
  const prev5 = list.slice(-10, -5);
  const best = list.reduce((b, e) => (e.pct > b.pct || (e.pct === b.pct && e.total > b.total) ? e : b), list[0]);
  return {
    shoots: list.length,
    targets: list.reduce((a, e) => a + e.shot, 0),
    kills: list.reduce((a, e) => a + e.total, 0),
    avgPct: pct(list),
    last5Pct: pct(last5),
    trend: prev5.length ? Math.round((pct(last5) - pct(prev5)) * 10) / 10 : null,
    best,
  };
}

function byDate(a, b) {
  return (a.date || '').localeCompare(b.date || '') || String(a.cardId).localeCompare(String(b.cardId));
}

function touch(card) {
  card.updatedAt = Date.now();
  return card;
}
