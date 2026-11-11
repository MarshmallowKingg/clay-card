/**
 * Clay Card: club database on a Google Sheet.
 * Paste into Extensions → Apps Script on the club's Sheet, set the PIN (see SETUP.md),
 * run `setup` once, then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Tabs (created automatically):
 *   Members   – the club register. Committee maintains it: Member No, Name, Active (Y/N).
 *   Check-ins – who has arrived for each shoot. Written by the app's Check-in screen.
 *   Scores    – one row per shooter per squad card. Re-submitting a card replaces its rows.
 */

const TABS = {
  Scores: ['Submitted', 'Card ID', 'Date', 'Ground', 'Shoot', 'Scorer', 'Member No', 'Name', 'Total', 'Out of', '%', 'Stand scores', 'Marks'],
  Members: ['Member No', 'Name', 'Active'],
  'Check-ins': ['Date', 'Shoot', 'Member No', 'Name', 'Checked in at'],
};
// Columns kept as plain text so Sheets doesn't turn dates, IDs or "007" into numbers.
const TEXT_COLS = { Scores: ['Submitted', 'Card ID', 'Date', 'Ground', 'Shoot', 'Scorer', 'Member No', 'Name', 'Stand scores', 'Marks'], Members: ['Member No', 'Name', 'Active'], 'Check-ins': ['Date', 'Shoot', 'Member No', 'Name', 'Checked in at'] };
const col = (tab, name) => TABS[tab].indexOf(name);

function doGet(e) {
  return handle_(() => {
    const p = e.parameter || {};
    checkPin_(p.pin);
    switch (p.action) {
      case 'ping': return {};
      case 'shoots': return { shoots: listShoots_() };
      case 'results': return { rows: results_(String(p.shoot || ''), String(p.date || '')) };
      case 'members': return { members: members_() };
      case 'checkins': return { checkins: checkins_(String(p.date || '')) };
      case 'history': return { rows: history_(String(p.memberNo || ''), String(p.name || '')) };
      default: throw new Error('Unknown action');
    }
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    checkPin_(body.pin);
    switch (body.action) {
      case 'submit': return { saved: withLock_(() => saveCard_(body.card)) };
      case 'checkin': return { checkins: withLock_(() => checkIn_(body, true)) };
      case 'uncheckin': return { checkins: withLock_(() => checkIn_(body, false)) };
      default: throw new Error('Unknown action');
    }
  });
}

/* ---------- Scores ---------- */

function saveCard_(card) {
  if (!card || !card.cardId || !card.shoot || !Array.isArray(card.shooters)) throw new Error('Card is missing details');
  checkDate_(card.date);
  if (card.shooters.length > 15) throw new Error('Too many shooters');

  const sh = sheet_('Scores');
  const ids = column_(sh, 'Scores', 'Card ID');
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i] === card.cardId) sh.deleteRow(i + 2);

  const now = stamp_();
  const rows = card.shooters.map((s) => [
    now, card.cardId, card.date, clean_(card.ground), clean_(card.shoot), clean_(card.scorer), clean_(s.memberNo), clean_(s.name),
    Number(s.total) || 0, Number(s.of) || 0, Number(s.pct) || 0,
    (s.standScores || []).map(Number).join('|'), clean_(s.marks),
  ]);
  append_(sh, rows);
  return rows.length;
}

function scoreRows_() {
  const C = (n) => col('Scores', n);
  return data_('Scores').map((r) => ({
    cardId: r[C('Card ID')], date: r[C('Date')], ground: r[C('Ground')], shoot: r[C('Shoot')], scorer: r[C('Scorer')],
    memberNo: r[C('Member No')], name: r[C('Name')],
    total: Number(r[C('Total')]), of: Number(r[C('Out of')]), pct: Number(r[C('%')]),
    standScores: String(r[C('Stand scores')]).split('|').filter(String).map(Number),
  }));
}

function listShoots_() {
  const map = {};
  for (const r of scoreRows_()) {
    const k = r.date + '\u0000' + r.shoot;
    if (!map[k]) map[k] = { date: r.date, shoot: r.shoot, shooters: 0 };
    map[k].shooters++;
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date) || a.shoot.localeCompare(b.shoot));
}

function results_(shoot, date) {
  return scoreRows_().filter((r) => r.shoot === shoot && r.date === date);
}

/** One person's scores: by membership number, or by name for guests without one. */
function history_(memberNo, name) {
  if (!memberNo && !name) throw new Error('Pick a person');
  const n = name.trim().toLowerCase();
  return scoreRows_()
    .filter((r) => (memberNo ? r.memberNo === memberNo : !r.memberNo && r.name.trim().toLowerCase() === n))
    .map((r) => ({ cardId: r.cardId, date: r.date, shoot: r.shoot, ground: r.ground, name: r.name, total: r.total, of: r.of, pct: r.pct, standScores: r.standScores }));
}

/* ---------- Members & check-ins ---------- */

function members_() {
  const C = (n) => col('Members', n);
  return data_('Members')
    .filter((r) => r[C('Name')] && !/^n/i.test(r[C('Active')]))
    .map((r) => ({ memberNo: r[C('Member No')].trim(), name: r[C('Name')].trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function checkins_(date) {
  checkDate_(date);
  const C = (n) => col('Check-ins', n);
  return data_('Check-ins')
    .filter((r) => r[C('Date')] === date)
    .map((r) => ({ date, shoot: r[C('Shoot')], memberNo: r[C('Member No')], name: r[C('Name')], at: r[C('Checked in at')] }));
}

/** Check a person in (on=true) or out for a shoot. Returns that day's check-ins. */
function checkIn_(b, on) {
  checkDate_(b.date);
  if (!b.shoot) throw new Error('Pick a shoot');
  const memberNo = String(b.memberNo || '').trim();
  const name = String(b.name || '').trim();
  if (!memberNo && !name) throw new Error('Pick a person');
  const sh = sheet_('Check-ins');
  const C = (n) => col('Check-ins', n);
  const rows = data_('Check-ins');
  const same = (r) => r[C('Date')] === b.date && r[C('Shoot')] === String(b.shoot) &&
    (memberNo ? r[C('Member No')] === memberNo : !r[C('Member No')] && r[C('Name')].toLowerCase() === name.toLowerCase());
  const found = rows.findIndex(same);
  if (on && found < 0) append_(sh, [[b.date, clean_(b.shoot), clean_(memberNo), clean_(name), stamp_()]]);
  if (!on && found >= 0) sh.deleteRow(found + 2);
  return checkins_(b.date);
}

/* ---------- Helpers ---------- */

function sheet_(tab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(tab);
  if (!sh) {
    sh = ss.insertSheet(tab);
    const h = TABS[tab];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
    for (const name of TEXT_COLS[tab]) sh.getRange(2, col(tab, name) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  }
  return sh;
}

function data_(tab) {
  const sh = sheet_(tab);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, TABS[tab].length).getDisplayValues();
}

function column_(sh, tab, name) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, col(tab, name) + 1, sh.getLastRow() - 1, 1).getDisplayValues().map((r) => r[0]);
}

function append_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function checkDate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) throw new Error('Bad date');
}

function checkPin_(pin) {
  const want = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!want) throw new Error('Club PIN not set on the server (see SETUP.md)');
  if (String(pin || '') !== want) throw new Error('Wrong club PIN');
}

// Stop anything that looks like a formula being written into the Sheet.
function clean_(v) {
  const s = String(v == null ? '' : v).slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: creates the three tabs and checks the PIN is set. */
function setup() {
  Object.keys(TABS).forEach(sheet_);
  const pin = PropertiesService.getScriptProperties().getProperty('PIN');
  Logger.log(pin ? 'Ready. PIN is set. Add members to the Members tab.' : 'Now set the PIN: Project Settings → Script properties → add PIN.');
}
