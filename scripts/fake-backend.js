// In-memory fake of the Google Sheet + Apps Script runtime, running the real backend/Code.gs.
// Used by the tests and by the local dev server.
import fs from 'node:fs';
import vm from 'node:vm';

export function loadBackend(pin = '1234') {
  const rows = []; // includes header row once created
  let sheet = null;
  const sh = {
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === 'string') return { setNumberFormat() { return this; } };
      return {
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = row.map(String); }); return this; },
        getDisplayValues() { return rows.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)); },
        setFontWeight() { return this; },
      };
    },
    getLastRow: () => rows.length,
    deleteRow: (i) => rows.splice(i - 1, 1),
    setFrozenRows() {},
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => (sheet = sh) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => pin }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '2026-11-15 12:00' },
    Session: { getScriptTimeZone: () => 'Europe/London' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8'), ctx);
  const get = (p) => JSON.parse(ctx.doGet({ parameter: p }).text);
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).text);
  return { get, post, rows };
}
