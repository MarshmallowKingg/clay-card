/**
 * Clay Card — club database on a Google Sheet.
 * Paste into Extensions → Apps Script on the club's Sheet, set the PIN (see SETUP.md),
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * One row per shooter per squad card. Re-submitting a card replaces its rows.
 */

const SHEET = 'Scores';
const HEADERS = ['Submitted', 'Card ID', 'Date', 'Ground', 'Shoot', 'Scorer', 'Name', 'Total', 'Out of', '%', 'Stand scores', 'Marks'];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

function doGet(e) {
  return handle_(() => {
    const p = e.parameter || {};
    checkPin_(p.pin);
    switch (p.action) {
      case 'ping': return {};
      case 'shoots': return { shoots: listShoots_() };
      case 'results': return { rows: results_(String(p.shoot || ''), String(p.date || '')) };
      default: throw new Error('Unknown action');
    }
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    checkPin_(body.pin);
    if (body.action !== 'submit') throw new Error('Unknown action');
    return { saved: saveCard_(body.card) };
  });
}

/* ---------- Actions ---------- */

function saveCard_(card) {
  if (!card || !card.cardId || !card.date || !card.shoot || !Array.isArray(card.shooters)) throw new Error('Card is missing details');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(card.date)) throw new Error('Bad date');
  if (card.shooters.length > 15) throw new Error('Too many shooters');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    // Remove this card's previous rows (bottom-up so indexes stay valid).
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, COL['Card ID'] + 1, sh.getLastRow() - 1, 1).getDisplayValues() : [];
    for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === card.cardId) sh.deleteRow(i + 2);

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const rows = card.shooters.map((s) => [
      now, card.cardId, card.date, clean_(card.ground), clean_(card.shoot), clean_(card.scorer), clean_(s.name),
      Number(s.total) || 0, Number(s.of) || 0, Number(s.pct) || 0,
      (s.standScores || []).map(Number).join('|'), clean_(s.marks),
    ]);
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

function listShoots_() {
  const map = {};
  for (const r of data_()) {
    const k = r[COL['Date']] + '\u0000' + r[COL['Shoot']];
    if (!map[k]) map[k] = { date: r[COL['Date']], shoot: r[COL['Shoot']], shooters: 0 };
    map[k].shooters++;
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date) || a.shoot.localeCompare(b.shoot));
}

function results_(shoot, date) {
  return data_()
    .filter((r) => r[COL['Shoot']] === shoot && r[COL['Date']] === date)
    .map((r) => ({
      cardId: r[COL['Card ID']], name: r[COL['Name']], scorer: r[COL['Scorer']], ground: r[COL['Ground']],
      total: Number(r[COL['Total']]), of: Number(r[COL['Out of']]), pct: Number(r[COL['%']]),
      standScores: String(r[COL['Stand scores']]).split('|').filter(String).map(Number),
    }));
}

/* ---------- Helpers ---------- */

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:G').setNumberFormat('@'); // keep dates and IDs as text
    sh.getRange('K:L').setNumberFormat('@');
  }
  return sh;
}

function data_() {
  const sh = sheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getDisplayValues();
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
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the Scores tab and check everything works. */
function setup() {
  sheet_();
  const pin = PropertiesService.getScriptProperties().getProperty('PIN');
  Logger.log(pin ? 'Ready. PIN is set.' : 'Now set the PIN: Project Settings → Script properties → add PIN.');
}
