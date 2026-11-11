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
  assert.equal(b.rows.length, 2); // header + 1
});

test('formula-looking text is neutralised', () => {
  const b = loadBackend();
  const a = squad(['=HYPERLINK("x")'], 'Lewis');
  b.post({ action: 'submit', pin: '1234', card: S.toSubmission(a) });
  assert.ok(b.rows[1][6].startsWith("'="));
});
