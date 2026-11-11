import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/scoring.js';

const card3 = () => S.newCard({ shoot: 'Club Sunday', ground: 'Notton', scorer: 'Lewis', date: '2026-11-15', shooters: ['Ann', 'Bob', 'Cat'], stands: S.makeStands(3, 4) });

test('new card has empty marks for every shooter and stand', () => {
  const c = card3();
  for (const s of c.shooters) {
    assert.equal(c.marks[s.id].length, 3);
    assert.deepEqual(c.marks[s.id][0], [null, null, null, null]);
  }
  assert.equal(S.targetCount(c), 12);
});

test('max 15 shooters', () => {
  assert.throws(() => S.newCard({ shooters: Array.from({ length: 16 }, (_, i) => `S${i}`) }));
  const c = S.newCard({ shooters: Array.from({ length: 15 }, (_, i) => `S${i}`) });
  assert.throws(() => S.addShooter(c, 'One too many'));
});

test('rotation: last shooter on a stand goes first on the next', () => {
  const c = S.newCard({ shooters: ['A', 'B', 'C', 'D'] });
  const names = (i) => S.shooterOrder(c, i).map((s) => s.name).join('');
  assert.equal(names(0), 'ABCD');
  assert.equal(names(1), 'DABC');
  assert.equal(names(2), 'CDAB');
  assert.equal(names(3), 'BCDA');
  assert.equal(names(4), 'ABCD');
  for (let i = 0; i < 5; i++) assert.equal(S.shooterOrder(c, i + 1)[0].name, S.shooterOrder(c, i).at(-1).name);
  c.rotate = false;
  assert.equal(names(2), 'ABCD');
});

test('tap cycles empty → X → O → empty', () => {
  const c = card3(); const a = c.shooters[0].id;
  S.cycleMark(c, a, 0, 0); assert.equal(c.marks[a][0][0], 'X');
  S.cycleMark(c, a, 0, 0); assert.equal(c.marks[a][0][0], 'O');
  S.cycleMark(c, a, 0, 0); assert.equal(c.marks[a][0][0], null);
});

test('rest killed fills only empty boxes', () => {
  const c = card3(); const a = c.shooters[0].id;
  S.setMark(c, a, 0, 1, 'O');
  S.restKilled(c, a, 0);
  assert.deepEqual(c.marks[a][0], ['X', 'O', 'X', 'X']);
  assert.deepEqual(S.standScore(c, a, 0), { kills: 3, shot: 4, of: 4 });
});

test('totals and percentage', () => {
  const c = card3(); const a = c.shooters[0].id;
  S.restKilled(c, a, 0); S.setMark(c, a, 1, 0, 'O'); S.setMark(c, a, 1, 1, 'X');
  const t = S.shooterTotals(c, a);
  assert.equal(t.total, 5); assert.equal(t.shot, 6); assert.equal(t.of, 12); assert.equal(t.pct, 83.3);
  assert.deepEqual(t.standScores, [4, 1, 0]);
});

test('completion', () => {
  const c = card3();
  assert.equal(S.isComplete(c), false);
  for (const s of c.shooters) for (let i = 0; i < 3; i++) S.restKilled(c, s.id, i);
  assert.equal(S.isStandComplete(c, 0), true);
  assert.equal(S.isComplete(c), true);
});

test('leaderboard: countback from the last stand backwards', () => {
  const rows = [
    { name: 'Ann', total: 80, standScores: [9, 8, 7] },
    { name: 'Bob', total: 80, standScores: [7, 8, 9] }, // better last stand
    { name: 'Cat', total: 85, standScores: [9, 9, 9] },
    { name: 'Dan', total: 80, standScores: [8, 7, 9] }, // = Bob on last, Bob better on stand 2
  ];
  const lb = S.leaderboard(rows);
  assert.deepEqual(lb.map((r) => r.name), ['Cat', 'Bob', 'Dan', 'Ann']);
  assert.deepEqual(lb.map((r) => r.posLabel), ['1', '2', '3', '4']);
  assert.equal(lb[2].countback, true);
});

test('leaderboard: exact ties share a position', () => {
  const lb = S.leaderboard([
    { name: 'Bob', total: 50, standScores: [5, 5] },
    { name: 'Ann', total: 50, standScores: [5, 5] },
    { name: 'Cat', total: 40, standScores: [4, 4] },
  ]);
  assert.deepEqual(lb.map((r) => `${r.posLabel}${r.name}`), ['=1Ann', '=1Bob', '3Cat']);
});

test('changing stands keeps existing marks and resizes', () => {
  const c = card3(); const a = c.shooters[0].id;
  S.restKilled(c, a, 0);
  S.setStands(c, [...S.makeStands(2, 4), { targets: 6, pairs: true }, { targets: 8, pairs: true }]);
  assert.deepEqual(c.marks[a][0], ['X', 'X', 'X', 'X']);
  assert.equal(c.marks[a][2].length, 6);
  assert.equal(c.marks[a][3].length, 8);
  assert.equal(c.stands[3].n, 4);
});

test('CSV escapes and orders by position', () => {
  const c = card3();
  c.shooters[0].name = 'Ann, "Ace"';
  S.restKilled(c, c.shooters[0].id, 0);
  const csv = S.toCSV(c).split('\n');
  assert.equal(csv[0], 'Pos,Name,Member no,S1,S2,S3,Total,Out of,%,Date,Ground,Shoot,Scorer');
  assert.ok(csv[1].startsWith('1,"Ann, ""Ace""",,4,0,0,4,12,100'));
});

test('WhatsApp text', () => {
  const c = card3();
  S.restKilled(c, c.shooters[1].id, 0);
  const txt = S.toWhatsApp(c);
  assert.match(txt, /^\*Club Sunday – Notton\*/);
  assert.match(txt, /1\. Bob — \*4\*\/12/);
  assert.match(txt, /Card not complete yet/);
});

test('submission payload and change tracking', () => {
  const c = card3(); const a = c.shooters[0].id;
  S.setMark(c, a, 0, 0, 'X'); S.setMark(c, a, 0, 1, 'O');
  const sub = S.toSubmission(c);
  assert.equal(sub.cardId, c.id);
  assert.equal(sub.shooters[0].marks, 'XO-- ---- ----');
  assert.equal(S.submissionState(c), 'not-submitted');
  c.submittedHash = S.hashCard(c);
  assert.equal(S.submissionState(c), 'submitted');
  S.setMark(c, a, 0, 2, 'X');
  assert.equal(S.submissionState(c), 'changed');
});

test('club layouts', () => {
  assert.deepEqual(S.LAYOUTS[0].build().map((s) => s.targets), [10, 10, 10, 10, 10]);
  assert.deepEqual(S.LAYOUTS[1].build(6).map((s) => s.targets), [8, 8, 8, 8, 8, 10]);
  assert.deepEqual(S.sixStandLayout(3).map((s) => s.targets), [8, 8, 10, 8, 8, 8]);
  assert.equal(S.targetCount({ stands: S.sixStandLayout() }), 50);
  assert.deepEqual(S.detectLayout(S.sixStandLayout(2)), { id: '6mixed', tenAt: 2 });
  assert.deepEqual(S.detectLayout(S.makeStands(5, 10)), { id: '5x10' });
  assert.equal(S.detectLayout(S.makeStands(10, 10)), null);
  assert.equal(S.newCard().stands.length, 5);
});

test('membership numbers and duplicates', () => {
  const c = S.newCard();
  S.addShooter(c, 'Lewis', '1042');
  assert.equal(c.shooters[0].memberNo, '1042');
  assert.throws(() => S.addShooter(c, 'Lewis R', '1042'), /already on this card/);
  S.addShooter(c, 'Guest');
  assert.throws(() => S.addShooter(c, 'guest'), /already/);
  S.addShooter(c, 'Lewis', '2000'); // same name, different member: allowed
  assert.equal(S.toSubmission(c).shooters[0].memberNo, '1042');
  assert.equal(S.cardLeaderboard(c).find((r) => r.name === 'Guest').memberNo, '');
});

test('individual history across cards', () => {
  const mk = (date, kills, memberNo = '1042', name = 'Lewis') => {
    const c = S.newCard({ date, shoot: 'Club', shooters: [{ name, memberNo }, 'Pete'] });
    const sid = c.shooters[0].id;
    S.restKilled(c, sid, 0); S.restKilled(c, sid, 1); S.restKilled(c, sid, 2); S.restKilled(c, sid, 3); S.restKilled(c, sid, 4);
    for (let t = 0; t < 50 - kills; t++) S.setMark(c, sid, Math.floor(t / 10), t % 10, 'O');
    return c;
  };
  const cards = [mk('2026-10-04', 40), mk('2026-09-06', 35), mk('2026-11-01', 45, '1042', 'Lewis Robinson'), S.newCard({ date: '2026-01-01', shooters: [{ name: 'Lewis', memberNo: '1042' }] })];
  const key = S.personKey({ memberNo: '1042' });
  const h = S.personHistory(cards, key);
  assert.deepEqual(h.map((e) => [e.date, e.total]), [['2026-09-06', 35], ['2026-10-04', 40], ['2026-11-01', 45]]); // empty card skipped
  const merged = S.mergeHistory(h, [
    { cardId: cards[0].id, date: '2026-10-04', total: 1, of: 50, pct: 2 }, // duplicate of a phone card → ignored
    { cardId: 'club1', date: '2026-08-01', total: 30, of: 50, pct: 60 },
  ]);
  assert.deepEqual(merged.map((e) => `${e.date}:${e.total}:${e.source}`), ['2026-08-01:30:club', '2026-09-06:35:phone', '2026-10-04:40:phone', '2026-11-01:45:phone']);
  const st = S.historyStats(merged);
  assert.equal(st.shoots, 4); assert.equal(st.avgPct, 75); assert.equal(st.best.total, 45); assert.equal(st.trend, null);
  // people list: member number wins over name changes, guests by name
  const ppl = S.people(cards);
  assert.deepEqual(ppl.map((p) => `${p.key}=${p.name}`), ['m:1042=Lewis Robinson', 'n:pete=Pete']);
  assert.deepEqual(S.historyStats([]), { shoots: 0 });
});
