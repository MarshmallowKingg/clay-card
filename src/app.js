// Clay Card — UI. Hash routes, string templates, one delegated click handler.

import * as S from './scoring.js';
import { store } from './storage.js';
import { CONFIG } from './config.js';
import { clubEnabled, submitCard, flushQueue, fetchShoots, fetchResults, checkPin, fetchMembers, fetchCheckins, setCheckin, fetchHistory } from './api.js';

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied`); }
  catch { prompt(`Copy ${label}:`, text); }
}

function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Screen wake lock while scoring ---------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported or refused — harmless */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && route().name === 'score') keepAwake(true); });

/* ---------- Routing ---------- */
function route() {
  const [name = '', id, extra] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'cards', id, extra };
}

function render() {
  const r = route();
  const card = r.id ? store.card(r.id) : null;
  if (['setup', 'score', 'results'].includes(r.name) && !card) return go('#/');
  keepAwake(r.name === 'score');
  document.documentElement.style.setProperty('--hdr', `${document.querySelector('.top').offsetHeight}px`);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === r.name));
  const views = { cards: viewCards, setup: viewSetup, score: viewScore, results: viewResults, club: viewClub, settings: viewSettings, checkin: viewCheckin, history: viewHistory };
  $view.innerHTML = (views[r.name] || viewCards)(card, r);
  if (r.name === 'club') loadClub();
  if (r.name === 'setup') { loadShootSuggestions(); loadSetupPeople(card); }
  if (r.name === 'checkin') loadCheckin();
  if (r.name === 'history') loadHistory(r.id);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

/* ---------- Views ---------- */

function statusBadge(card) {
  const st = S.submissionState(card);
  if (store.queue().includes(card.id)) return '<span class="badge wait">Waiting for signal</span>';
  if (!clubEnabled()) return '';
  return { submitted: '<span class="badge ok">Submitted</span>', changed: '<span class="badge warn">Changed since submit</span>', 'not-submitted': '' }[st];
}

function viewCards() {
  const cards = store.cards().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const list = cards.map((c) => {
    const done = c.stands.filter((_, i) => S.isStandComplete(c, i)).length;
    const lead = S.cardLeaderboard(c)[0];
    return `<li><a class="cardrow" href="#/score/${c.id}">
      <div><strong>${esc(c.shoot || 'English Sporting')}</strong>
        <span class="muted">${esc(S.formatDate(c.date))}${c.ground ? ' · ' + esc(c.ground) : ''}</span>
        <span class="muted">${c.shooters.length} shooters · ${done}/${c.stands.length} stands ${statusBadge(c)}</span></div>
      ${lead && lead.total ? `<div class="lead"><span>${esc(lead.name)}</span><b>${lead.total}</b></div>` : ''}
    </a></li>`;
  }).join('');
  return `<section class="pad">
    <button class="btn primary big" data-action="new-card">+ New card</button>
    ${cards.length ? `<ul class="cards">${list}</ul>` : `<div class="empty"><p>No cards yet.</p><button class="btn" data-action="demo">Load an example card</button></div>`}
    ${store.queue().length ? `<p class="note">${store.queue().length} card(s) waiting to send. They'll go when you have signal. <button class="link" data-action="flush">Try now</button></p>` : ''}
  </section>`;
}

const fmtPerson = (p) => (p.memberNo ? `${p.name} · ${p.memberNo}` : p.name);
/** "Name · 1042" → { name, memberNo } */
function parsePerson(text) {
  const m = String(text).trim().match(/^(.*\S)\s+·\s+(\S+)$/);
  return m ? { name: m[1], memberNo: m[2] } : { name: String(text).trim(), memberNo: '' };
}
const onCard = (card, p) => card.shooters.some((s) => S.personKey(s) === S.personKey(p));

function viewSetup(card) {
  const layout = S.detectLayout(card.stands);
  const recent = S.people(store.cards()).filter((p) => !onCard(card, p)).slice(0, 12);
  return `<section class="pad setup">
    <h1>Card setup</h1>
    <div class="grid2">
      <label>Date<input type="date" data-field="date" value="${esc(card.date)}"></label>
      <label>Scorer<input data-field="scorer" value="${esc(card.scorer)}" autocomplete="name"></label>
    </div>
    <label>Shoot<input data-field="shoot" value="${esc(card.shoot)}" list="shoots" placeholder="e.g. Sunday 50"></label>
    <datalist id="shoots"></datalist>
    <label>Ground<input data-field="ground" value="${esc(card.ground)}" list="grounds"></label>
    <datalist id="grounds">${store.knownGrounds().map((g) => `<option value="${esc(g)}">`).join('')}</datalist>

    <h2>Layout <span class="muted">${card.stands.length} stands · ${S.targetCount(card)} targets</span></h2>
    <div class="seg">${S.LAYOUTS.map((l) => `<button class="${layout?.id === l.id ? 'on' : ''}" data-action="layout" data-id="${l.id}">${esc(l.label)}</button>`).join('')}</div>
    ${layout?.id === '6mixed' ? `<div class="tenat"><span class="muted small">10-bird<br>stand</span>${[1, 2, 3, 4, 5, 6].map((n) => `<button class="chip ${layout.tenAt === n ? 'on' : ''}" data-action="tenat" data-n="${n}">${n}</button>`).join('')}</div>` : ''}
    <div class="standstrip">${card.stands.map((st) => `<span><b>${st.n}</b>${st.targets}</span>`).join('')}</div>
    <details ${layout ? '' : 'open'}><summary>Custom layout</summary>
      <label>Stands<input type="number" min="1" max="30" data-stands="count" value="${card.stands.length}" inputmode="numeric"></label>
      <div class="perstand">${card.stands.map((st, i) => `<label>S${st.n}<input type="number" min="1" max="30" data-stand="${i}" value="${st.targets}" inputmode="numeric"></label>`).join('')}</div>
    </details>

    <h2>Squad <span class="muted">${card.shooters.length}/${S.MAX_SHOOTERS}</span></h2>
    ${clubEnabled() ? `<div class="panel" id="checkedin"><p class="muted small">Loading today's check-ins…</p></div>` : ''}
    <ol class="squad">${card.shooters.map((s, i) => `<li>
      <input data-shooter="${s.id}" value="${esc(s.name)}" aria-label="Shooter ${i + 1} name">
      <input class="memno" data-memno="${s.id}" value="${esc(s.memberNo)}" placeholder="No." aria-label="Membership number" inputmode="numeric">
      <button class="icon" data-action="up" data-id="${s.id}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
      <button class="icon" data-action="remove" data-id="${s.id}" aria-label="Remove">✕</button></li>`).join('')}</ol>
    ${card.shooters.length < S.MAX_SHOOTERS ? `<form class="addrow" data-form="add-shooter">
      <input name="name" placeholder="Name (or pick a member)" list="memberlist" autocomplete="off">
      <input name="memberNo" class="memno" placeholder="No." inputmode="numeric" autocomplete="off">
      <button class="btn">Add</button></form>
      <datalist id="memberlist"></datalist>
      ${recent.length ? `<p class="muted small">Recent</p><div class="chips">${recent.map((p) => `<button class="chip" data-action="quick-add" data-name="${esc(p.name)}" data-no="${esc(p.memberNo)}">+ ${esc(fmtPerson(p))}</button>`).join('')}</div>` : ''}` : ''}
    <label class="check"><input type="checkbox" data-field="rotate" ${card.rotate ? 'checked' : ''}> Rotate: last shooter on a stand goes first on the next</label>

    <div class="actions">
      <button class="btn primary big" data-action="start" ${card.shooters.length ? '' : 'disabled'}>Start scoring →</button>
      <button class="btn danger" data-action="delete">Delete card</button>
    </div>
  </section>`;
}

/** Fill the member datalist and the "checked in today" panel on the setup screen. */
async function loadSetupPeople(card) {
  if (!clubEnabled() || !store.settings().pin) {
    const p = document.getElementById('checkedin');
    if (p) p.innerHTML = '<p class="muted small">Enter the club PIN in ⚙ Settings to pick from today\'s check-ins.</p>';
    return;
  }
  fetchMembers().then((members) => {
    const dl = document.getElementById('memberlist');
    if (dl) dl.innerHTML = members.map((m) => `<option value="${esc(fmtPerson(m))}">`).join('');
  }).catch(() => {});
  const panel = document.getElementById('checkedin');
  try {
    const all = await fetchCheckins(card.date);
    if (!document.body.contains(panel)) return;
    const shoots = [...new Set(all.map((c) => c.shoot))];
    const mine = card.shoot && shoots.includes(card.shoot) ? all.filter((c) => c.shoot === card.shoot) : all;
    if (!all.length) { panel.innerHTML = `<p class="muted small">Nobody checked in for ${esc(S.formatDate(card.date))} yet. <a href="#/checkin">Check people in</a></p>`; return; }
    const free = mine.filter((p) => !onCard(card, p));
    panel.innerHTML = `<div class="panelhead"><b>Checked in${card.shoot && shoots.includes(card.shoot) ? ` · ${esc(card.shoot)}` : ' today'}</b>
        <span class="muted small">${mine.length - free.length}/${mine.length} on this card</span>
        ${free.length > 1 && card.shooters.length + free.length <= S.MAX_SHOOTERS ? '<button class="link" data-action="add-all">Add all</button>' : ''}</div>
      <div class="chips">${mine.map((p) => {
        const added = onCard(card, p);
        return `<button class="chip ${added ? 'on' : ''}" ${added ? 'disabled' : ''} data-action="quick-add" data-name="${esc(p.name)}" data-no="${esc(p.memberNo)}" data-shoot="${esc(p.shoot)}">${added ? '✓' : '+'} ${esc(fmtPerson(p))}</button>`;
      }).join('')}</div>
      ${!card.shoot && shoots.length === 1 ? `<p class="muted small">Tip: adding someone sets the shoot to “${esc(shoots[0])}”.</p>` : ''}`;
    panel._free = free;
  } catch (e) {
    if (document.body.contains(panel)) panel.innerHTML = `<p class="muted small">${esc(e.message)}${e.offline ? ': no signal and no saved check-in list.' : ''}</p>`;
  }
}

function cellsHtml(card, sid, si) {
  const st = card.stands[si];
  const row = card.marks[sid][si];
  let html = '';
  for (let t = 0; t < st.targets; t++) {
    const m = row[t];
    const cls = m === S.KILL ? 'x' : m === S.LOST ? 'o' : '';
    const gap = st.pairs && t % 2 === 1 && t < st.targets - 1 ? ' gap' : '';
    html += `<button class="cell ${cls}${gap}" data-action="tap" data-sid="${sid}" data-t="${t}" aria-label="Target ${t + 1}: ${m === 'X' ? 'kill' : m === 'O' ? 'lost' : 'not shot'}">${m === 'X' ? '✕' : m === 'O' ? '○' : ''}</button>`;
  }
  return html;
}

function viewScore(card, r) {
  const si = Math.min(Math.max(parseInt(r.extra, 10) || 0, 0), card.stands.length - 1);
  const order = S.shooterOrder(card, si);
  const tabs = card.stands.map((s, i) => `<a href="#/score/${card.id}/${i}" class="tab ${i === si ? 'on' : ''} ${S.isStandComplete(card, i) ? 'done' : ''}">${s.n}</a>`).join('');
  const rows = order.map((s, i) => {
    const sc = S.standScore(card, s.id, si);
    const tot = S.shooterTotals(card, s.id);
    return `<li class="shooter ${sc.shot === sc.of ? 'complete' : ''}" data-row="${s.id}">
      <div class="who"><span class="n">${i + 1}</span><span class="name">${esc(s.name)}</span>
        <span class="sc"><b>${sc.kills}</b>/${sc.of}</span><span class="tot">${tot.total}</span></div>
      <div class="cells">${cellsHtml(card, s.id, si)}</div>
      <div class="rowbtns">
        <button class="mini" data-action="rest" data-sid="${s.id}" ${sc.shot === sc.of ? 'disabled' : ''}>Rest killed</button>
        <button class="mini ghost" data-action="clear" data-sid="${s.id}" ${sc.shot ? '' : 'disabled'}>Clear</button>
      </div></li>`;
  }).join('');
  return `<div class="standbar"><div class="tabs" role="tablist">${tabs}</div></div>
  <section class="pad score" data-stand="${si}">
    <div class="standhead"><h1>Stand ${card.stands[si].n}</h1><span class="muted">${card.stands[si].targets} targets · tap: ✕ kill → ○ lost → clear</span></div>
    <ol class="shooters">${rows}</ol>
  </section>
  <footer class="dock">
    <button class="btn" data-action="stand" data-to="${si - 1}" ${si ? '' : 'disabled'}>← Prev</button>
    <a class="btn" href="#/results/${card.id}">Results</a>
    ${si < card.stands.length - 1 ? `<button class="btn primary" data-action="stand" data-to="${si + 1}">Next →</button>` : `<a class="btn primary" href="#/results/${card.id}">Finish</a>`}
  </footer>`;
}

function boardHtml(rows, standCount) {
  if (!rows.length) return '<p class="muted">No scores yet.</p>';
  return `<div class="scroll"><table class="board">
    <thead><tr><th>Pos</th><th class="l">Name</th>${Array.from({ length: standCount }, (_, i) => `<th class="s">${i + 1}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.posLabel}</td><td class="l">${esc(r.name)}${r.countback ? ' <small title="Placed on countback">cb</small>' : ''}${r.scorer ? `<small class="muted"> · ${esc(r.scorer)}</small>` : ''}</td>
      ${r.standScores.map((v) => `<td class="s">${v}</td>`).join('')}<td><b>${r.total}</b></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function viewResults(card) {
  const rows = S.cardLeaderboard(card);
  const complete = S.isComplete(card);
  const st = S.submissionState(card);
  const queued = store.queue().includes(card.id);
  return `<section class="pad">
    <h1>${esc(card.shoot || 'Results')}</h1>
    <p class="muted">${esc(S.formatDate(card.date))}${card.ground ? ' · ' + esc(card.ground) : ''} · ${S.targetCount(card)} targets</p>
    ${complete ? '' : '<p class="note">Card not complete yet.</p>'}
    ${boardHtml(rows, card.stands.length)}
    <p class="muted small">Ties are split on countback: last stand first, then working backwards.</p>
    <div class="actions">
      ${clubEnabled() ? `<button class="btn primary big" data-action="submit">${queued ? 'Waiting for signal — retry' : st === 'submitted' ? '✓ Submitted — send again' : st === 'changed' ? 'Re-submit changes' : 'Submit to club'}</button>` : ''}
      <button class="btn" data-action="copy-text">Copy for WhatsApp</button>
      <button class="btn" data-action="csv">Download CSV</button>
      <a class="btn" href="#/score/${card.id}">Back to scoring</a>
      <a class="btn ghost" href="#/setup/${card.id}">Edit card setup</a>
    </div>
  </section>`;
}

function viewClub() {
  if (!clubEnabled()) return `<section class="pad"><h1>${esc(CONFIG.CLUB_NAME)}</h1><p class="note">The club database isn't set up yet. See SETUP.md: it takes about 20 minutes.</p></section>`;
  return `<section class="pad"><h1>${esc(CONFIG.CLUB_NAME)} results</h1>
    <label>Shoot<select id="shootpick"><option>Loading…</option></select></label>
    <div id="clubboard"><p class="muted">Loading…</p></div></section>`;
}

function viewSettings() {
  const s = store.settings();
  return `<section class="pad setup"><h1>Settings</h1>
    <label>Your name (default scorer)<input data-setting="scorer" value="${esc(s.scorer)}" autocomplete="name"></label>
    ${clubEnabled() ? `<label>Club PIN<input data-setting="pin" value="${esc(s.pin)}" inputmode="numeric" autocomplete="off"></label>
      <button class="btn" data-action="check-pin">Test connection</button>` : '<p class="note">Club database not set up: scores stay on this phone.</p>'}
    <label>Theme<select data-setting="theme">${['auto', 'light', 'dark'].map((t) => `<option ${s.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <h2>Your data</h2>
    <p class="muted small">Cards are saved on this phone only, plus whatever you submit to the club. Clearing browser data deletes them.</p>
    <button class="btn" data-action="backup">Download backup (JSON)</button>
    <label class="btn file">Restore backup<input type="file" accept="application/json" data-action="restore" hidden></label>
  </section>`;
}

/* ---------- Check-in (club office) ---------- */

const ci = { date: S.today(), shoot: '', q: '' };

function viewCheckin() {
  if (!clubEnabled()) return '<section class="pad"><h1>Check-in</h1><p class="note">Needs the club database. See SETUP.md.</p></section>';
  ci.shoot ||= store.settings().ciShoot || '';
  return `<section class="pad setup"><h1>Check-in</h1>
    <div class="grid2">
      <label>Date<input type="date" id="ci-date" value="${esc(ci.date)}"></label>
      <label>Shoot<input id="ci-shoot" value="${esc(ci.shoot)}" list="ci-shoots" placeholder="e.g. Sunday 50"></label>
    </div>
    <datalist id="ci-shoots"></datalist>
    <input id="ci-q" type="search" placeholder="Search name or number" value="${esc(ci.q)}" autocomplete="off">
    <div id="ci-list"><p class="muted">Loading members…</p></div>
    <h2>Guest</h2>
    <form class="addrow" data-form="guest"><input name="name" placeholder="Guest name" autocomplete="off"><button class="btn">Check in</button></form>
  </section>`;
}

let ciData = { members: [], checkins: [] };
async function loadCheckin() {
  const list = document.getElementById('ci-list');
  try {
    const [members, checkins] = await Promise.all([fetchMembers(), fetchCheckins(ci.date)]);
    ciData = { members, checkins };
    renderCheckinList();
  } catch (e) { if (list) list.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

function renderCheckinList() {
  const list = document.getElementById('ci-list');
  if (!list) return;
  const dl = document.getElementById('ci-shoots');
  const shoots = [...new Set([...ciData.checkins.map((c) => c.shoot), ...store.cards().map((c) => c.shoot).filter(Boolean)])];
  if (dl) dl.innerHTML = shoots.map((x) => `<option value="${esc(x)}">`).join('');
  const here = ciData.checkins.filter((c) => c.shoot === ci.shoot);
  const isIn = (p) => here.some((c) => S.personKey(c) === S.personKey(p));
  const q = ci.q.trim().toLowerCase();
  const guests = here.filter((c) => !c.memberNo);
  const rows = [...ciData.members, ...guests]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.memberNo || '').includes(q))
    .sort((a, b) => Number(isIn(b)) - Number(isIn(a)) || a.name.localeCompare(b.name));
  list.innerHTML = !ci.shoot ? '<p class="note">Enter the shoot name first, so squads can find their shooters.</p>' : `
    <p class="muted small"><b>${here.length}</b> checked in for ${esc(ci.shoot)} on ${esc(S.formatDate(ci.date))}</p>
    <ul class="people">${rows.map((p) => `<li><button class="person ${isIn(p) ? 'in' : ''}" data-action="toggle-in" data-name="${esc(p.name)}" data-no="${esc(p.memberNo || '')}">
      <span>${esc(p.name)}${p.memberNo ? '' : ' <small class="muted">guest</small>'}</span><span class="muted small">${esc(p.memberNo || '')}</span><b>${isIn(p) ? '✓ In' : 'Check in'}</b></button></li>`).join('') || '<li class="muted">No matches</li>'}</ul>`;
}

/* ---------- History ---------- */

function viewHistory() {
  return `<section class="pad"><h1>Score history</h1>
    <label>Shooter<select id="h-person"><option value="">Loading…</option></select></label>
    <div id="h-body"></div></section>`;
}

async function loadHistory(selected) {
  const pick = document.getElementById('h-person');
  let members = [];
  if (clubEnabled() && store.settings().pin) { try { members = await fetchMembers(); } catch { /* phone data only */ } }
  const ppl = S.people(store.cards(), members);
  const me = store.settings().scorer.toLowerCase();
  selected = selected ? decodeURIComponent(selected) : (ppl.find((p) => p.name.toLowerCase() === me) || ppl[0] || {}).key;
  if (!pick) return;
  pick.innerHTML = ppl.length ? ppl.map((p) => `<option value="${esc(p.key)}" ${p.key === selected ? 'selected' : ''}>${esc(fmtPerson(p))}</option>`).join('') : '<option value="">No shooters yet</option>';
  pick.onchange = () => go(`#/history/${encodeURIComponent(pick.value)}`);
  if (selected) showHistory(ppl.find((p) => p.key === selected));
}

async function showHistory(person) {
  const body = document.getElementById('h-body');
  if (!person || !body) return;
  const local = S.personHistory(store.cards(), person.key);
  const draw = (entries, note = '') => {
    const st = S.historyStats(entries);
    if (!st.shoots) { body.innerHTML = `<p class="muted">No scores yet for ${esc(person.name)}.</p>${note}`; return; }
    const trend = st.trend === null ? '' : `<small class="${st.trend >= 0 ? 'up' : 'down'}">${st.trend >= 0 ? '▲' : '▼'} ${Math.abs(st.trend)}</small>`;
    body.innerHTML = `
      <div class="tiles">
        <div><span>Average</span><b>${st.avgPct}%</b></div>
        <div><span>Last 5</span><b>${st.last5Pct}%</b>${trend}</div>
        <div><span>Best</span><b>${st.best.total}/${st.best.shot}</b><small>${esc(S.formatDate(st.best.date))}</small></div>
        <div><span>Shoots</span><b>${st.shoots}</b><small>${st.kills}/${st.targets} targets</small></div>
      </div>
      ${chartSvg(entries.filter((e) => e.shot))}
      <div class="scroll"><table class="board">
        <thead><tr><th class="l">Date</th><th class="l">Shoot</th><th>Score</th><th>%</th></tr></thead>
        <tbody>${entries.slice().reverse().map((e) => `<tr><td class="l">${esc(S.formatDate(e.date))}</td><td class="l">${esc(e.shoot || '')}${e.source === 'club' ? ' <small class="muted">club</small>' : ''}</td><td><b>${e.total}</b>/${e.shot}</td><td>${e.pct}</td></tr>`).join('')}</tbody>
      </table></div>${note}`;
  };
  draw(local, clubEnabled() ? '<p class="muted small">Loading club scores…</p>' : '<p class="muted small">Scores from cards on this phone.</p>');
  if (!clubEnabled() || !store.settings().pin) return;
  try {
    const remote = await fetchHistory(person);
    draw(S.mergeHistory(local, remote), '<p class="muted small">Includes every card submitted to the club.</p>');
  } catch (e) {
    draw(local, `<p class="muted small">Club scores unavailable (${esc(e.message)}). Showing this phone only.</p>`);
  }
}

/** Simple line chart of % per shoot. */
function chartSvg(entries) {
  if (entries.length < 2) return '';
  const W = 340, H = 150, P = { l: 30, r: 10, t: 12, b: 22 };
  const vals = entries.map((e) => e.pct);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (entries.length - 1);
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo || 1);
  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.pct).toFixed(1)}`).join(' ');
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${P.l - 4}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const first = entries[0].date, last = entries.at(-1).date;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score percentage over time">
    ${grid}<polyline points="${pts}" class="l"/>${entries.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.pct)}" r="3.5"><title>${esc(S.formatDate(e.date))}: ${e.total}/${e.shot} (${e.pct}%)</title></circle>`).join('')}
    <text x="${P.l}" y="${H - 4}">${esc(S.formatDate(first))}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">${esc(S.formatDate(last))}</text>
  </svg><figcaption class="muted small">% of targets shot, per shoot</figcaption></figure>`;
}

/* ---------- Async loaders ---------- */

async function loadShootSuggestions() {
  if (!clubEnabled() || !store.settings().pin) return;
  try {
    const shoots = await fetchShoots();
    const dl = document.getElementById('shoots');
    if (dl) dl.innerHTML = [...new Set(shoots.map((s) => s.shoot))].map((n) => `<option value="${esc(n)}">`).join('');
  } catch { /* suggestions are optional */ }
}

async function loadClub() {
  const pick = document.getElementById('shootpick');
  const board = document.getElementById('clubboard');
  try {
    const shoots = await fetchShoots();
    if (!shoots.length) { pick.innerHTML = '<option>No shoots yet</option>'; board.innerHTML = ''; return; }
    pick.innerHTML = shoots.map((s, i) => `<option value="${i}">${esc(S.formatDate(s.date))} · ${esc(s.shoot)} (${s.shooters})</option>`).join('');
    const show = async () => {
      const s = shoots[pick.value];
      board.innerHTML = '<p class="muted">Loading…</p>';
      const rows = await fetchResults(s.shoot, s.date);
      const lb = S.leaderboard(rows);
      const squads = new Set(rows.map((r) => r.cardId)).size;
      board.innerHTML = `<p class="muted small">${rows.length} shooters from ${squads} squad card${squads === 1 ? '' : 's'}</p>${boardHtml(lb, Math.max(0, ...rows.map((r) => r.standScores.length)))}`;
    };
    pick.onchange = () => show().catch((e) => { board.innerHTML = `<p class="note">${esc(e.message)}</p>`; });
    await show();
  } catch (e) {
    pick.innerHTML = '<option>—</option>';
    board.innerHTML = `<p class="note">${esc(e.message)}${e.offline ? ': open this again when you have signal.' : ''}</p>`;
  }
}

/* ---------- Events ---------- */

function currentCard() { const r = route(); return r.id ? store.card(r.id) : null; }
function save(card) { if (!store.saveCard(card)) toast('Could not save: phone storage full?'); }

/** Re-render only the shooter row on the score screen, so scrolling doesn't jump. */
function refreshRow(card, sid) {
  const si = parseInt(document.querySelector('.score')?.dataset.stand, 10);
  const li = document.querySelector(`[data-row="${sid}"]`);
  if (!li || Number.isNaN(si)) return render();
  const sc = S.standScore(card, sid, si);
  li.querySelector('.cells').innerHTML = cellsHtml(card, sid, si);
  li.querySelector('.sc').innerHTML = `<b>${sc.kills}</b>/${sc.of}`;
  li.querySelector('.tot').textContent = S.shooterTotals(card, sid).total;
  li.classList.toggle('complete', sc.shot === sc.of);
  li.querySelector('[data-action="rest"]').disabled = sc.shot === sc.of;
  li.querySelector('[data-action="clear"]').disabled = !sc.shot;
  document.querySelectorAll('.tab')[si]?.classList.toggle('done', S.isStandComplete(card, si));
  if (sc.shot === sc.of && S.isStandComplete(card, si)) toast(`Stand ${card.stands[si].n} complete`);
}

$view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const card = currentCard();
  const si = parseInt(document.querySelector('.score')?.dataset.stand, 10);

  switch (a) {
    case 'new-card': {
      const st = store.settings();
      const l = S.LAYOUTS.find((x) => x.id === st.layout) || S.LAYOUTS[0];
      const c = S.newCard({ scorer: st.scorer, stands: l.build(st.tenAt || 6), shoot: st.ciShoot && st.ciShootDate === S.today() ? st.ciShoot : '' });
      save(c); go(`#/setup/${c.id}`); break;
    }
    case 'demo': {
      const c = S.newCard({ shoot: 'Example – delete me', ground: 'Practice ground', scorer: store.settings().scorer || 'You', shooters: ['Alex', 'Sam', 'Jo', 'Chris'], stands: S.sixStandLayout(6) });
      c.shooters.forEach((s, k) => [0, 1, 2].forEach((i) => { S.restKilled(c, s.id, i); for (let t = 0; t <= k; t++) S.setMark(c, s.id, i, (t * 3 + i) % 8, 'O'); }));
      save(c); go(`#/score/${c.id}/3`); break;
    }
    case 'flush': { const n = await flushQueue(); toast(n ? `Sent ${n} card(s)` : 'Still no signal'); render(); break; }
    case 'quick-add':
      try {
        S.addShooter(card, el.dataset.name, el.dataset.no || '');
        if (el.dataset.shoot && !card.shoot) card.shoot = el.dataset.shoot;
        save(card); render();
      } catch (err) { toast(err.message); }
      break;
    case 'add-all': {
      const free = document.getElementById('checkedin')?._free || [];
      let n = 0;
      for (const p of free) { try { S.addShooter(card, p.name, p.memberNo); n++; } catch { /* full or duplicate */ } }
      if (!card.shoot && free[0]) card.shoot = free[0].shoot;
      save(card); render(); toast(`Added ${n}`); break;
    }
    case 'layout': {
      const l = S.LAYOUTS.find((x) => x.id === el.dataset.id);
      const ok = !card.shooters.some((sh) => S.shooterTotals(card, sh.id).shot) || confirm('Change layout? Scores on stands that disappear will be lost.');
      if (ok) { S.setStands(card, l.build(6)); store.saveSettings({ layout: l.id }); save(card); render(); }
      break;
    }
    case 'tenat': S.setStands(card, S.sixStandLayout(+el.dataset.n)); store.saveSettings({ tenAt: +el.dataset.n }); save(card); render(); break;
    case 'toggle-in': {
      const p = { name: el.dataset.name, memberNo: el.dataset.no };
      const on = !el.classList.contains('in');
      el.disabled = true;
      try { ciData.checkins = await setCheckin({ date: ci.date, shoot: ci.shoot, ...p }, on); renderCheckinList(); }
      catch (err) { toast(err.offline ? 'No signal: check-in needs signal' : err.message); el.disabled = false; }
      break;
    }
    case 'remove': {
      const s = card.shooters.find((x) => x.id === el.dataset.id);
      if (S.shooterTotals(card, s.id).shot && !confirm(`Remove ${s.name} and their scores?`)) return;
      S.removeShooter(card, s.id); save(card); render(); break;
    }
    case 'up': {
      const i = card.shooters.findIndex((x) => x.id === el.dataset.id);
      [card.shooters[i - 1], card.shooters[i]] = [card.shooters[i], card.shooters[i - 1]];
      save(card); render(); break;
    }
    case 'preset': S.setStands(card, S.makeStands(+el.dataset.n, +el.dataset.t)); save(card); render(); break;
    case 'start': go(`#/score/${card.id}/0`); break;
    case 'delete':
      if (confirm('Delete this card? This cannot be undone.')) { store.deleteCard(card.id); go('#/'); }
      break;
    case 'tap': S.cycleMark(card, el.dataset.sid, si, +el.dataset.t); save(card); refreshRow(card, el.dataset.sid); break;
    case 'rest': S.restKilled(card, el.dataset.sid, si); save(card); refreshRow(card, el.dataset.sid); break;
    case 'clear':
      if (confirm('Clear this shooter\'s scores on this stand?')) { S.clearStand(card, el.dataset.sid, si); save(card); refreshRow(card, el.dataset.sid); }
      break;
    case 'stand': go(`#/score/${card.id}/${el.dataset.to}`); break;
    case 'copy-text': copy(S.toWhatsApp(card), 'Results'); break;
    case 'csv': download(`claycard-${card.date}-${(card.shoot || 'card').replace(/\W+/g, '-')}.csv`, S.toCSV(card)); break;
    case 'submit': {
      if (!card.shoot || !card.date) { toast('Add a shoot name and date first'); return go(`#/setup/${card.id}`); }
      if (!S.isComplete(card) && !confirm('Card isn\'t complete. Submit anyway?')) return;
      el.disabled = true; el.textContent = 'Sending…';
      try { await submitCard(card); toast('Submitted to club ✓'); }
      catch (err) { toast(err.offline ? 'No signal: it will send automatically when you have signal' : err.message); }
      render(); break;
    }
    case 'check-pin':
      try { await checkPin(); toast('Connected ✓'); } catch (err) { toast(err.message); }
      break;
    case 'backup': download(`claycard-backup-${S.today()}.json`, JSON.stringify(store.cards(), null, 1), 'application/json'); break;
  }
});

$view.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.dataset.form === 'add-shooter') {
    e.preventDefault();
    const p = parsePerson(f.name.value);
    const memberNo = f.memberNo.value.trim() || p.memberNo;
    if (!p.name) return;
    const card = currentCard();
    try { S.addShooter(card, p.name, memberNo); save(card); render(); document.querySelector('[data-form="add-shooter"] input')?.focus(); }
    catch (err) { toast(err.message); }
  } else if (f.dataset.form === 'guest') {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name || !ci.shoot) return toast(ci.shoot ? 'Enter a name' : 'Enter the shoot name first');
    try { ciData.checkins = await setCheckin({ date: ci.date, shoot: ci.shoot, name }, true); f.reset(); renderCheckinList(); toast(`${name} checked in`); }
    catch (err) { toast(err.message); }
  }
});

$view.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ci-q') { ci.q = t.value; renderCheckinList(); }
  // Picking "Name · 1042" from the member list fills in the number.
  if (t.name === 'name' && t.form?.dataset.form === 'add-shooter') {
    const p = parsePerson(t.value);
    if (p.memberNo) { t.value = p.name; t.form.memberNo.value = p.memberNo; }
  }
});

$view.addEventListener('change', async (e) => {
  const t = e.target;
  const card = currentCard();
  if (t.dataset.field) {
    card[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.value.trim();
    save(card);
  } else if (t.id === 'ci-date' || t.id === 'ci-shoot') {
    ci.date = document.getElementById('ci-date').value || S.today();
    ci.shoot = document.getElementById('ci-shoot').value.trim();
    store.saveSettings({ ciShoot: ci.shoot, ciShootDate: ci.date });
    if (t.id === 'ci-date') loadCheckin(); else renderCheckinList();
  } else if (t.dataset.memno) {
    const s = card.shooters.find((x) => x.id === t.dataset.memno);
    const v = t.value.trim();
    if (v && card.shooters.some((x) => x !== s && x.memberNo === v)) { toast('That number is already on this card'); t.value = s.memberNo; return; }
    s.memberNo = v; save(card);
  } else if (t.dataset.shooter) {
    const s = card.shooters.find((x) => x.id === t.dataset.shooter);
    if (t.value.trim()) { s.name = t.value.trim(); save(card); } else t.value = s.name;
  } else if (t.dataset.stands) {
    const n = Math.min(Math.max(parseInt(t.value, 10) || 1, 1), 30);
    const last = card.stands[card.stands.length - 1] || { targets: 10, pairs: true };
    const next = card.stands.slice(0, n);
    while (next.length < n) next.push({ ...last });
    S.setStands(card, next);
    save(card); render();
  } else if (t.dataset.stand) {
    card.stands[+t.dataset.stand].targets = Math.min(Math.max(parseInt(t.value, 10) || 1, 1), 30);
    S.setStands(card, card.stands); save(card); render();
  } else if (t.dataset.setting) {
    store.saveSettings({ [t.dataset.setting]: t.value.trim() });
    if (t.dataset.setting === 'theme') applyTheme();
  } else if (t.dataset.action === 'restore' && t.files[0]) {
    try {
      const cards = JSON.parse(await t.files[0].text());
      if (!Array.isArray(cards)) throw new Error();
      cards.forEach((c) => c.id && c.shooters && store.saveCard(c));
      toast(`Restored ${cards.length} card(s)`);
    } catch { toast('That file isn\'t a Clay Card backup'); }
  }
});

function applyTheme() {
  const th = store.settings().theme;
  if (th === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = th;
}

/* ---------- Start ---------- */
applyTheme();
render();
window.addEventListener('online', () => flushQueue().then((n) => { if (n) { toast(`Sent ${n} waiting card(s) ✓`); render(); } }));
flushQueue().then((n) => { if (n) { toast(`Sent ${n} waiting card(s) ✓`); render(); } });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
