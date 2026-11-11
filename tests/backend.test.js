// Runs backend/Code.gs in a VM against an in-memory fake of SpreadsheetApp & co.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/scoring.js';
import { loadBackend } from '../scripts/fake-backend.js';

function squad(names, scorer) {
  const c = S.newCard({ shoot: 'Club 50', date: '2026-11-15', ground: 'Notton', scorer, shooters: names, stands: S.makeStands(5, 10) });
  c.shooters.forEach((s, k) => c.stands.forEach((_, i) => { S.restKilled(c, s.id, i); if (i < k) S.setMark(c, s.id, i, 0, 'O'); }));
  return c;
}

test('rejects a wrong or missing PIN', () => {
  const b = loadBackend();
  assert.deepEqual(b.get({ action: 'ping', pin: '9' }), { ok: false, error: 'Wrong club PIN' });
  assert.equal(b.post({ action: 'submit', card: {} }).ok, false);
  assert.equal(b.get({ action: 'ping', pin: '1234' }).ok, true);
});

test('submit, list shoots and combine squads', () => {
  const b = loadBackend();
  const a = squad(['Ann', 'Bob'], 'Lewis');
  const c = squad(['Cat', 'Dan', 'Eve'], 'Pete');
  assert.deepEqual(b.post({ action: 'submit', pin: '1234', card: S.toSubmission(a) }), { ok: true, saved: 2 });
  assert.equal(b.post({ action: 'submit', pin: '1234', card: S.toSubmission(c) }).saved, 3);

  const shoots = b.get({ action: 'shoots', pin: '1234' }).shoots;
  assert.deepEqual(shoots, [{ date: '2026-11-15', shoot: 'Club 50', shooters: 5 }]);

  const res = b.get({ action: 'results', pin: '1234', shoot: 'Club 50', date: '2026-11-15' }).rows;
  assert.equal(res.length, 5);
  const lb = S.leaderboard(res);
  assert.deepEqual(lb.map((r) => `${r.posLabel} ${r.name} ${r.total}`), ['=1 Ann 50', '=1 Cat 50', '=3 Bob 49', '=3 Dan 49', '5 Eve 48']);
  assert.deepEqual(lb[0].standScores, [10, 10, 10, 10, 10]);
});

test('re-submitting a card replaces its rows', () => {
  const b = loadBackend();
  const a = squad(['Ann', 'Bob'], 'Lewis');
  b.post({ action: 'submit', pin: '1234', card: S.toSubmission(a) });
  S.removeShooter(a, a.shooters[1].id);
  S.setMark(a, a.shooters[0].id, 4, 9, 'O');
  b.post({ action: 'submit', pin: '1234', card: S.toSubmission(a) });
  const res = b.get({ action: 'results', pin: '1234', shoot: 'Club 50', date: '2026-11-15' }).rows;
  assert.deepEqual(res.map((r) => [r.name, r.total]), [['Ann', 49]]);
  assert.equal(b.sheets.Scores.rows.length, 2); // header + 1
});

test('formula-looking text is neutralised', () => {
  const b = loadBackend();
  const a = squad(['=HYPERLINK("x")'], 'Lewis');
  b.post({ action: 'submit', pin: '1234', card: S.toSubmission(a) });
  assert.ok(b.sheets.Scores.rows[1][7].startsWith("'="));
});

const MEMBERS = [['1042', 'Lewis Robinson', 'Y'], ['0007', 'Pete Smith', ''], ['1100', 'Old Member', 'N'], ['1200', 'Ann Jones', 'Y']];
const P = { pin: '1234' };

test('members: active only, sorted, numbers kept as text', () => {
  const b = loadBackend('1234', MEMBERS);
  assert.deepEqual(b.get({ ...P, action: 'members' }).members, [
    { memberNo: '1200', name: 'Ann Jones' }, { memberNo: '1042', name: 'Lewis Robinson' }, { memberNo: '0007', name: 'Pete Smith' },
  ]);
});

test('check in, no duplicates, check out, guests by name', () => {
  const b = loadBackend('1234', MEMBERS);
  const ci = (extra, on = true) => b.post({ ...P, action: on ? 'checkin' : 'uncheckin', date: '2026-11-15', shoot: 'Club 50', ...extra });
  ci({ memberNo: '1042', name: 'Lewis Robinson' });
  ci({ memberNo: '1042', name: 'Lewis Robinson' });
  ci({ memberNo: '0007', name: 'Pete Smith' });
  let list = ci({ name: 'Guest Gary' }).checkins;
  assert.deepEqual(list.map((c) => c.memberNo || c.name), ['1042', '0007', 'Guest Gary']);
  list = ci({ memberNo: '0007' }, false).checkins;
  assert.deepEqual(list.map((c) => c.memberNo || c.name), ['1042', 'Guest Gary']);
  // other days are separate
  b.post({ ...P, action: 'checkin', date: '2026-11-22', shoot: 'Club 50', memberNo: '1200', name: 'Ann Jones' });
  assert.equal(b.get({ ...P, action: 'checkins', date: '2026-11-15' }).checkins.length, 2);
  assert.equal(b.get({ ...P, action: 'checkins', date: '2026-11-22' }).checkins.length, 1);
  assert.equal(b.post({ ...P, action: 'checkin', date: 'today', shoot: 'x', name: 'y' }).ok, false);
});

test('history by member number, and by name for guests', () => {
  const b = loadBackend('1234', MEMBERS);
  const card = (date, name, memberNo, kills) => {
    const c = S.newCard({ shoot: 'Club 50', date, shooters: [{ name, memberNo }] });
    c.stands.forEach((_, i) => S.restKilled(c, c.shooters[0].id, i));
    for (let t = 0; t < 50 - kills; t++) S.setMark(c, c.shooters[0].id, Math.floor(t / 10), t % 10, 'O');
    b.post({ ...P, action: 'submit', card: S.toSubmission(c) });
  };
  card('2026-10-01', 'Lewis Robinson', '1042', 40);
  card('2026-11-01', 'Lewis R', '1042', 44);
  card('2026-11-01', 'Guest Gary', '', 30);
  const h = b.get({ ...P, action: 'history', memberNo: '1042' }).rows;
  assert.deepEqual(h.map((r) => [r.date, r.total, r.of]), [['2026-10-01', 40, 50], ['2026-11-01', 44, 50]]);
  assert.equal(b.get({ ...P, action: 'history', name: 'guest gary' }).rows[0].total, 30);
  const res = b.get({ ...P, action: 'results', shoot: 'Club 50', date: '2026-11-01' }).rows;
  assert.deepEqual(res.map((r) => r.memberNo), ['1042', '']);
});
