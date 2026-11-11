// Talks to the club's Google Apps Script web app (backend/Code.gs).
// POSTs use text/plain so the browser skips the CORS preflight that Apps Script can't answer.

import { CONFIG } from './config.js';
import { store } from './storage.js';
import { toSubmission, hashCard } from './scoring.js';

export const clubEnabled = () => Boolean(CONFIG.API_URL);

export class ApiError extends Error {
  constructor(message, { offline = false } = {}) { super(message); this.offline = offline; }
}

async function call(method, params) {
  if (!clubEnabled()) throw new ApiError('Club database not set up');
  const pin = store.settings().pin;
  if (!pin) throw new ApiError('Enter the club PIN in Settings');
  let res;
  try {
    if (method === 'GET') {
      const q = new URLSearchParams({ ...params, pin });
      res = await fetch(`${CONFIG.API_URL}?${q}`, { redirect: 'follow' });
    } else {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...params, pin }),
      });
    }
  } catch {
    throw new ApiError('No signal', { offline: true });
  }
  let data;
  try { data = await res.json(); } catch { throw new ApiError(`Club server error (${res.status})`); }
  if (!data.ok) throw new ApiError(data.error || 'Club server error');
  return data;
}

/** Send a card. On no signal it's queued and sent later; other errors are thrown. */
export async function submitCard(card) {
  try {
    await call('POST', { action: 'submit', card: toSubmission(card) });
  } catch (e) {
    if (e.offline) store.enqueue(card.id);
    throw e;
  }
  card.submittedAt = Date.now();
  card.submittedHash = hashCard(card);
  store.saveCard(card);
  store.dequeue(card.id);
  return card;
}

/** Try to send anything waiting in the queue. Returns the number sent. */
export async function flushQueue() {
  if (!clubEnabled() || !navigator.onLine) return 0;
  let sent = 0;
  for (const id of store.queue()) {
    const card = store.card(id);
    if (!card) { store.dequeue(id); continue; }
    try { await submitCard(card); sent++; } catch (e) { if (e.offline) break; }
  }
  return sent;
}

export const fetchShoots = () => call('GET', { action: 'shoots' }).then((d) => d.shoots);
export const fetchResults = (shoot, date) => call('GET', { action: 'results', shoot, date }).then((d) => d.rows);
export const checkPin = () => call('GET', { action: 'ping' });
