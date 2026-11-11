// In-memory fake of the Google Sheet + Apps Script runtime, running the real backend/Code.gs.
// Used by the tests and by the local dev server.
import fs from 'node:fs';
import vm from 'node:vm';

function fakeSheet() {
  const rows = []; // row 1 = headers
  return {
    rows,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = row.map(String); }); return this; },
        getDisplayValues() { return rows.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)); },
        setFontWeight() { return this; },
        setNumberFormat() { return this; },
      };
    },
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    deleteRow: (i) => rows.splice(i - 1, 1),
    setFrozenRows() {},
  };
}

/**
 * @param pin       club PIN set on the "server"
 * @param members   optional [[memberNo, name, active]] to pre-load the Members tab
 */
export function loadBackend(pin = '1234', members = []) {
  const sheets = {};
  let now = '2026-11-15 12:00';
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = fakeSheet()) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => pin }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => now },
    Session: { getScriptTimeZone: () => 'Europe/London' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8'), ctx);
  ctx.setup();
  members.forEach((m, i) => { sheets.Members.rows[i + 1] = m.map(String); });
  const get = (p) => JSON.parse(ctx.doGet({ parameter: p }).text);
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).text);
  return { get, post, sheets, setNow: (t) => { now = t; } };
}
