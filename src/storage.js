// Local persistence. Everything lives on the phone in localStorage; the club Sheet is a copy.

const K = { cards: 'claycard.cards', settings: 'claycard.settings', queue: 'claycard.queue', cache: 'claycard.cache.' };

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const store = {
  cards() { return read(K.cards, []); },
  card(id) { return this.cards().find((c) => c.id === id) || null; },
  saveCard(card) {
    const all = this.cards();
    const i = all.findIndex((c) => c.id === card.id);
    if (i >= 0) all[i] = card; else all.unshift(card);
    return write(K.cards, all);
  },
  deleteCard(id) {
    write(K.cards, this.cards().filter((c) => c.id !== id));
    this.dequeue(id);
  },

  settings() { return { pin: '', scorer: '', theme: 'auto', ...read(K.settings, {}) }; },
  saveSettings(patch) { return write(K.settings, { ...this.settings(), ...patch }); },

  // Cards waiting to be sent to the club (no signal at the time).
  queue() { return read(K.queue, []); },
  enqueue(id) { const q = this.queue(); if (!q.includes(id)) { q.push(id); write(K.queue, q); } },
  dequeue(id) { write(K.queue, this.queue().filter((x) => x !== id)); },

  // Last copy of club data (members, check-ins, history) so setup still works with no signal.
  cached(key) { return read(K.cache + key, null); },
  setCached(key, value) { write(K.cache + key, { at: Date.now(), value }); return value; },

  /** Names used on previous cards, most recent first — for quick squad entry. */
  knownNames() {
    const seen = new Set();
    for (const c of this.cards()) for (const s of c.shooters) seen.add(s.name);
    return [...seen];
  },
  knownGrounds() {
    return [...new Set(this.cards().map((c) => c.ground).filter(Boolean))];
  },
};
