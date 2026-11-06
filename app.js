import * as store from './store.js';
import { DEFAULT_INSTRUMENTS, SESSIONS, WEEKDAYS, computeTrade, sessionOf, summarize, breakdown } from './calc.js';
import { equityChart } from './charts.js';

/* =====================================================================
   Helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStr = (d) => toLocalInput(d).slice(0, 10);
const lsGet = (k) => { try { return localStorage.getItem('ftmui_' + k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('ftmui_' + k, v); } catch { /* private mode */ } };
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const uniq = (a) => [...new Set(a.filter(Boolean))];
const numOrNull = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  bars: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  wallet: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
};
const icon = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

const TABS = [
  ['dashboard', 'Dashboard', 'grid'], ['trades', 'Trades', 'list'], ['journal', 'Journal', 'book'],
  ['reports', 'Reports', 'bars'], ['accounts', 'Accounts', 'wallet'], ['settings', 'Settings', 'sliders'],
];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
const BIAS = ['Bullish', 'Bearish', 'Range'];
const SETUP_HINTS = ['Breakout', 'Pullback', 'Reversal', 'Liquidity sweep', 'Supply/Demand', 'Trend continuation'];
const MISTAKE_HINTS = ['FOMO', 'Revenge trade', 'Moved stop loss', 'Exited early', 'Oversized', 'No setup', 'Ignored news', 'Overtrading'];
const EMOTION_HINTS = ['Calm', 'Confident', 'Anxious', 'Greedy', 'Fearful', 'Frustrated', 'Bored'];
const ACCENTS = ['#5b8def', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#94a3b8'];
const ACC_TYPES = ['Live', 'Demo', 'Prop firm', 'Other'];

/* =====================================================================
   State
   ===================================================================== */
const S = {
  user: null, accounts: [], trades: [], journal: {}, prefs: {}, bg: null, instList: null,
  loaded: {}, unsubs: [], promptedAcc: false,
  tab: lsGet('tab') || 'dashboard', scope: lsGet('scope') || 'all', period: lsGet('period') || 'all',
  calMonth: new Date(), jDate: dayStr(new Date()), repDim: lsGet('repDim') || 'instrument',
  f: { q: '', inst: '', dir: '', res: '' },
};
if (!TABS.some((t) => t[0] === S.tab)) S.tab = 'dashboard';

const instList = () => S.instList || DEFAULT_INSTRUMENTS;
const instMap = () => Object.fromEntries(instList().map((i) => [i.name, i]));
const accName = (id) => S.accounts.find((a) => a.id === id)?.name || 'Deleted account';

const fmtCache = {};
function money(v, { sign = false, dec = 2 } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const cur = S.prefs.currency || 'USD', k = cur + dec;
  if (!fmtCache[k]) {
    try { fmtCache[k] = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    catch { fmtCache[k] = new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  }
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + fmtCache[k].format(Math.abs(v));
}
const pct = (v, d = 0) => (v == null ? '—' : (v * 100).toFixed(d) + '%');
const f2 = (v) => (v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2));
const fmtDT = (s) => (s ? new Date(s).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtDay = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 2600);
}
async function safe(fn, msg = 'Something went wrong') {
  try { return await fn(); } catch (e) { console.error(e); toast(msg + (e && e.message ? ': ' + e.message : ''), true); }
}

/* =====================================================================
   Appearance (theme, accent, background picture)
   ===================================================================== */
function onColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111418' : '#ffffff';
}
function applyPrefs() {
  const p = S.prefs, root = document.documentElement;
  const theme = p.theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);
  const acc = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : ACCENTS[0];
  root.style.setProperty('--accent', acc);
  root.style.setProperty('--on-accent', onColor(acc));
  if (/^#[0-9a-f]{6}$/i.test(p.bgColor || '')) root.style.setProperty('--bg', p.bgColor); else root.style.removeProperty('--bg');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#0e1013';
  const bg = $('#bg'), has = !!(S.bg && S.bg.data);
  document.body.classList.toggle('has-bg', has);
  bg.style.backgroundImage = has ? `url("${S.bg.data}")` : 'none';
  const blur = Number(p.blur) || 0;
  bg.style.filter = blur ? `blur(${blur}px)` : 'none';
  bg.style.transform = blur ? 'scale(1.08)' : 'none';
  root.style.setProperty('--dim', p.dim == null ? 0.6 : Number(p.dim));
}
let prefTimer, prefDirty = false;
function savePrefs(patch) {
  Object.assign(S.prefs, patch);
  applyPrefs();
  prefDirty = true;
  clearTimeout(prefTimer);
  prefTimer = setTimeout(async () => {
    await safe(() => store.set('settings', 'prefs', S.prefs, true), 'Could not save settings');
    prefDirty = false;
  }, 400);
}

/* =====================================================================
   Data subscriptions
   ===================================================================== */
function startData() {
  stopData();
  const sub = (col, fn) => S.unsubs.push(store.listen(col, (list) => { fn(list); S.loaded[col] = true; render(); }));
  sub('accounts', (l) => {
    S.accounts = l.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (S.scope !== 'all' && !S.accounts.some((a) => a.id === S.scope)) { S.scope = 'all'; lsSet('scope', 'all'); }
    if (!l.length && !S.promptedAcc && S.user) { S.promptedAcc = true; setTimeout(() => openAccount(null, true), 300); }
  });
  sub('trades', (l) => { S.trades = l; });
  sub('journal', (l) => { S.journal = Object.fromEntries(l.map((j) => [j.id, j])); });
  sub('settings', (l) => {
    const by = Object.fromEntries(l.map((d) => [d.id, d]));
    const { id, ...prefs } = by.prefs || {};
    if (!prefDirty) S.prefs = prefs;
    S.bg = by.bg || null;
    S.instList = by.instruments && Array.isArray(by.instruments.list) ? by.instruments.list : null;
    applyPrefs();
  });
}
function stopData() {
  S.unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  S.unsubs = []; S.loaded = {}; S.accounts = []; S.trades = []; S.journal = {}; S.prefs = {}; S.bg = null; S.instList = null; S.promptedAcc = false;
  applyPrefs();
}

/* =====================================================================
   Derived data
   ===================================================================== */
function enrich(t, inst) {
  const c = computeTrade(t, inst);
  const when = t.closeTime || t.openTime || '';
  return { ...t, c, ts: new Date(when).getTime() || 0, day: when.slice(0, 10), session: sessionOf(t.openTime) };
}
function periodCutoff() {
  const now = new Date(), p = S.period;
  if (p === 'today') return dayStr(now);
  if (p === '7' || p === '30') { const d = new Date(now); d.setDate(d.getDate() - (+p - 1)); return dayStr(d); }
  if (p === 'month') return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  if (p === 'year') return `${now.getFullYear()}-01-01`;
  return null;
}
// Trades for the selected account(s) + period. base = starting balance of that window.
function ctx({ period = true } = {}) {
  const inst = instMap();
  const accs = S.scope === 'all' ? S.accounts : S.accounts.filter((a) => a.id === S.scope);
  const ids = new Set(accs.map((a) => a.id));
  let ts = S.trades.filter((t) => ids.has(t.accountId)).map((t) => enrich(t, inst));
  const start = sum(accs.map((a) => +a.startBalance || 0));
  let base = start;
  const cut = period ? periodCutoff() : null;
  if (cut) {
    base += sum(ts.filter((t) => t.c.closed && t.day < cut).map((t) => t.c.net));
    ts = ts.filter((t) => t.day >= cut);
  }
  return { ts, accs, start, base };
}

/* =====================================================================
   Rendering
   ===================================================================== */
let raf;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(doRender); }

function renderChrome() {
  const nav = TABS.map(([id, label, ic]) => `<button class="nav ${S.tab === id ? 'on' : ''}" data-act="nav" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
  $('#sideNav').innerHTML = nav;
  $('#bottomNav').innerHTML = nav;
  const sel = $('#scopeSel');
  const opts = `<option value="all">All accounts</option>` + S.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  sel.value = S.scope;
  $('#periodSel').value = S.period;
  $('.filters').hidden = ['settings', 'accounts'].includes(S.tab);
  $('#periodSel').hidden = ['journal'].includes(S.tab);
  const u = S.user;
  $('#who').innerHTML = `${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc((u.name || '?')[0])}</span>`}<div><b>${esc(u.name)}</b><small>${esc(u.email || (u.demo ? 'Saved in this browser' : ''))}</small></div>`;
  $('#demoBar').hidden = !u.demo;
}

function doRender() {
  if (!S.user) return;
  renderChrome();
  const ae = document.activeElement;
  if (ae && $('#view').contains(ae) && ae.matches('input,textarea,select') && (S.tab === 'journal' || S.tab === 'settings')) return;
  const loading = !(S.loaded.accounts && S.loaded.trades);
  const v = loading ? { html: '<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>' } : VIEWS[S.tab]();
  const view = $('#view');
  view.innerHTML = v.html;
  if (v.mount) v.mount(view);
}

/* ---------------- Dashboard ---------------- */
const kpi = (l, v, s = '', c = '') => `<div class="card kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;

function emptyState(sample = true) {
  return `<div class="card empty"><h2>${S.accounts.length ? 'No trades yet' : 'Welcome 👋'}</h2>
    <p>${S.accounts.length ? 'Log your first trade and your dashboard will come alive.' : 'Create your first trading account to get started.'}</p>
    ${S.accounts.length ? `<button class="btn primary" data-act="add-trade">Add your first trade</button>` : `<button class="btn primary" data-act="add-account">Create account</button>`}
    ${sample && S.user.demo ? `<button class="btn" data-act="sample">Load sample data</button>` : ''}</div>`;
}

function viewDashboard() {
  if (!S.accounts.length || !S.trades.length) return { html: emptyState() };
  const { ts, accs, base } = ctx();
  const m = summarize(ts, base);
  const eq = equityChart(m.curve, base);
  const kp = [
    kpi('Net P&L', money(m.net, { sign: true }), `${m.n} closed trade${m.n === 1 ? '' : 's'}${m.open ? ` · ${m.open} open` : ''}`, cls(m.net)),
    kpi('Win rate', pct(m.winRate), `${m.wins}W · ${m.losses}L · ${m.be}BE`),
    kpi('Profit factor', f2(m.pf), 'Gross profit ÷ gross loss'),
    kpi('Expectancy', money(m.expectancy, { sign: true }), `per trade · avg ${m.avgR == null ? '—' : m.avgR.toFixed(2) + 'R'}`, cls(m.expectancy)),
    kpi('Avg win / loss', `${money(m.avgWin, { dec: 0 })} / ${money(m.avgLoss, { dec: 0 })}`, `Payoff ratio ${f2(m.payoff)}`),
    kpi('Max drawdown', pct(m.maxDDPct, 1), money(-m.maxDD), m.maxDD > 0 ? 'neg' : ''),
    kpi('Rule adherence', pct(m.discipline), 'Trades where you followed your rules'),
    kpi('Streaks', `${m.maxW}W / ${m.maxL}L`, 'Longest win / loss run'),
  ].join('');

  let accTable = '';
  if (S.scope === 'all' && S.accounts.length > 1) {
    const inst = instMap();
    const rows = S.accounts.map((a) => {
      const mine = ts.filter((t) => t.accountId === a.id);
      const s = summarize(mine, 0);
      const allNet = sum(S.trades.filter((t) => t.accountId === a.id).map((t) => enrich(t, inst)).filter((t) => t.c.closed).map((t) => t.c.net));
      return `<tr><td>${esc(a.name)} <span class="badge">${esc(a.type || 'Live')}</span></td><td class="r">${s.n}</td><td class="r">${pct(s.winRate)}</td><td class="r ${cls(s.net)}">${money(s.net, { sign: true })}</td><td class="r">${money((+a.startBalance || 0) + allNet)}</td></tr>`;
    }).join('');
    accTable = `<div class="card" style="margin-top:14px"><div class="card-h"><h3>Accounts overview</h3></div><div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="r">Trades</th><th class="r">Win rate</th><th class="r">Net P&amp;L</th><th class="r">Balance</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  const recent = [...ts].sort((a, b) => b.ts - a.ts).slice(0, 6).map((t) =>
    `<tr class="click" data-act="edit-trade" data-id="${esc(t.id)}"><td>${esc(t.instrument)} <span class="badge ${t.direction}">${t.direction === 'short' ? 'Short' : 'Long'}</span></td><td class="muted">${fmtDay(t.day).replace(/, \d{4}$/, '')}</td><td class="r ${cls(t.c.net)}">${t.c.closed ? money(t.c.net, { sign: true }) : 'Open'}</td></tr>`).join('');

  const html = `<div class="page-h"><h2>${S.scope === 'all' ? 'All accounts' : esc(accName(S.scope))}</h2><span class="muted">${accs.length} account${accs.length === 1 ? '' : 's'} · balance <b class="num">${money(m.balance)}</b></span></div>
    <div class="grid kpis">${kp}</div>
    <div class="grid two">
      <div class="card"><div class="card-h"><h3>Equity curve</h3><span class="readout" id="eqOut">${money(m.balance)}</span></div>${eq.html}</div>
      <div class="card"><div class="card-h"><h3>Recent trades</h3><button class="btn sm ghost" data-act="nav" data-tab="trades">View all</button></div>
        ${recent ? `<table><tbody>${recent}</tbody></table>` : '<div class="empty small">No trades in this period.</div>'}</div>
    </div>
    <div class="card" style="margin-top:14px">${calendarHtml(ctx({ period: false }).ts)}</div>
    ${accTable}`;
  return {
    html,
    mount() {
      const el = $('#eq');
      if (!el || !eq.pos) return;
      const cur = $('.eq-cur', el), dot = $('.eq-dot', el), out = $('#eqOut'), n = m.curve.length, rest = money(m.balance);
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        let i = Math.round((((e.clientX - r.left) / r.width) * 800 - 10) / 780 * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        const p = eq.pos(i);
        cur.hidden = dot.hidden = false;
        cur.style.left = p.x + '%'; dot.style.left = p.x + '%'; dot.style.top = p.y + '%';
        out.textContent = `${m.curve[i].label} · ${money(m.curve[i].bal)}`;
      });
      el.addEventListener('pointerleave', () => { cur.hidden = dot.hidden = true; out.textContent = rest; });
    },
  };
}

function calendarHtml(ts) {
  const base = S.calMonth, y = base.getFullYear(), mo = base.getMonth();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  const by = {};
  for (const t of ts) if (t.c.closed) { const d = (by[t.day] = by[t.day] || { net: 0, n: 0 }); d.net += t.c.net; d.n++; }
  const today = dayStr(new Date());
  let cells = WEEKDAYS.map((d) => `<div class="dow">${d}</div>`).join('') + '<div class="d out"></div>'.repeat(lead);
  let total = 0, count = 0;
  for (let d = 1; d <= dim; d++) {
    const key = `${y}-${pad(mo + 1)}-${pad(d)}`, i = by[key];
    if (i) { total += i.net; count += i.n; }
    cells += `<div class="d ${i ? 'has ' + (i.net > 0 ? 'win' : i.net < 0 ? 'loss' : '') : ''} ${key === today ? 'today' : ''}" ${i ? `data-act="cal-day" data-day="${key}"` : ''}>
      <b>${d}</b>${i ? `<i class="${cls(i.net)}">${money(i.net, { sign: true, dec: 0 })}</i><small>${i.n} trade${i.n > 1 ? 's' : ''}</small>` : ''}</div>`;
  }
  const title = base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="card-h"><h3>P&amp;L calendar</h3><div class="cal-h"><span class="muted num">${count} trades · <b class="${cls(total)}">${money(total, { sign: true })}</b></span>
    <button class="btn sm ghost" data-act="cal-prev" aria-label="Previous month">${icon('left')}</button><b style="min-width:120px;text-align:center">${title}</b>
    <button class="btn sm ghost" data-act="cal-next" aria-label="Next month">${icon('right')}</button></div></div><div class="cal">${cells}</div>`;
}

/* ---------------- Trades ---------------- */
function filteredTrades() {
  const { ts } = ctx();
  const f = S.f, q = f.q.trim().toLowerCase();
  return ts.filter((t) => {
    if (f.inst && t.instrument !== f.inst) return false;
    if (f.dir && t.direction !== f.dir) return false;
    if (f.res === 'win' && !(t.c.closed && t.c.net > 0)) return false;
    if (f.res === 'loss' && !(t.c.closed && t.c.net < 0)) return false;
    if (f.res === 'be' && !(t.c.closed && t.c.net === 0)) return false;
    if (f.res === 'open' && t.c.closed) return false;
    if (q && ![t.instrument, t.setup, t.notes, t.mistake, t.emotion, (t.tags || []).join(' ')].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.ts - a.ts);
}
function tradeRows() {
  const rows = filteredTrades();
  if (!rows.length) return `<tr><td colspan="11"><div class="empty small">No trades match.</div></td></tr>`;
  const showAcc = S.scope === 'all';
  return rows.map((t) => `<tr class="click" data-act="edit-trade" data-id="${esc(t.id)}">
    <td>${fmtDT(t.openTime)}</td>${showAcc ? `<td class="muted hide-m">${esc(accName(t.accountId))}</td>` : ''}
    <td><b>${esc(t.instrument)}</b></td><td><span class="badge ${t.direction}">${t.direction === 'short' ? 'Short' : 'Long'}</span></td>
    <td class="r hide-m">${t.lots ?? ''}</td><td class="r hide-m">${t.c.pips == null ? '—' : t.c.pips.toFixed(1)}</td>
    <td class="r ${cls(t.c.net)}"><b>${t.c.closed ? money(t.c.net, { sign: true }) : 'Open'}</b></td>
    <td class="r hide-m">${t.c.r == null ? '—' : t.c.r.toFixed(2) + 'R'}</td><td class="hide-m">${esc(t.setup || '')}</td>
    <td class="stars hide-m">${'★'.repeat(t.rating || 0)}</td><td class="muted">${(t.shots || []).length ? icon('camera') : ''}</td></tr>`).join('');
}
function viewTrades() {
  if (!S.accounts.length) return { html: emptyState() };
  const insts = uniq([...instList().map((i) => i.name), ...S.trades.map((t) => t.instrument)]);
  const showAcc = S.scope === 'all';
  const html = `<div class="page-h"><h2>Trades</h2><span class="muted" id="tradeCount"></span></div>
    <div class="toolbar">
      <input id="fq" type="search" placeholder="Search setup, notes, tags…" value="${esc(S.f.q)}">
      <select id="fi"><option value="">All instruments</option>${insts.map((i) => `<option ${S.f.inst === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select>
      <select id="fd"><option value="">Long &amp; short</option><option value="long" ${S.f.dir === 'long' ? 'selected' : ''}>Long</option><option value="short" ${S.f.dir === 'short' ? 'selected' : ''}>Short</option></select>
      <select id="fr"><option value="">All results</option>${[['win', 'Winners'], ['loss', 'Losers'], ['be', 'Breakeven'], ['open', 'Open']].map(([v, l]) => `<option value="${v}" ${S.f.res === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="card" style="padding:6px 8px"><div class="tbl-wrap"><table><thead><tr><th>Opened</th>${showAcc ? '<th class="hide-m">Account</th>' : ''}<th>Symbol</th><th>Side</th><th class="r hide-m">Lots</th><th class="r hide-m">Pips/pts</th><th class="r">Net P&amp;L</th><th class="r hide-m">R</th><th class="hide-m">Setup</th><th class="hide-m">Rating</th><th></th></tr></thead>
    <tbody id="tradeRows">${tradeRows()}</tbody></table></div></div>`;
  return {
    html,
    mount() {
      const refresh = () => { $('#tradeRows').innerHTML = tradeRows(); $('#tradeCount').textContent = `${filteredTrades().length} shown`; };
      refresh();
      $('#fq').addEventListener('input', (e) => { S.f.q = e.target.value; refresh(); });
      $('#fi').addEventListener('change', (e) => { S.f.inst = e.target.value; refresh(); });
      $('#fd').addEventListener('change', (e) => { S.f.dir = e.target.value; refresh(); });
      $('#fr').addEventListener('change', (e) => { S.f.res = e.target.value; refresh(); });
    },
  };
}

/* ---------------- Journal (daily) ---------------- */
let jTimer = null, jPending = null;
function flushJournal() {
  if (!jPending) return;
  clearTimeout(jTimer);
  const { date, data } = jPending; jPending = null;
  safe(() => store.set('journal', date, { date, ...data, updatedAt: Date.now() }), 'Could not save journal');
  const el = $('#jSaved'); if (el) el.textContent = 'Saved';
}
function viewJournal() {
  const d = S.jDate, j = S.journal[d] || {};
  const { ts } = ctx({ period: false });
  const day = ts.filter((t) => t.day === d).sort((a, b) => a.ts - b.ts);
  const m = summarize(day, 0);
  const recent = Object.values(S.journal).filter((x) => x.plan || x.review || x.lessons || x.news).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 10);
  const field = (k, label, ph, rows = 3) => `<label class="f"><span>${label}</span><textarea class="jr" data-k="${k}" rows="${rows}" placeholder="${ph}">${esc(j[k] || '')}</textarea></label>`;
  const html = `<div class="page-h"><h2>Daily journal</h2>
      <div class="cal-h"><button class="btn sm" data-act="j-prev" aria-label="Previous day">${icon('left')}</button>
      <input type="date" id="jDate" value="${d}" style="width:auto"><button class="btn sm" data-act="j-next" aria-label="Next day">${icon('right')}</button>
      <button class="btn sm" data-act="j-today">Today</button></div></div>
    <div class="grid j-grid">
      <div class="card stack">
        <div class="card-h" style="margin:0"><h3>${fmtDay(d)}</h3><span class="saved" id="jSaved"></span></div>
        <label class="f"><span>Mood / emotional state</span><select class="jr" data-k="mood"><option value="">—</option>${EMOTION_HINTS.map((e) => `<option ${j.mood === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
        ${field('news', 'News &amp; events today (CPI, NFP, FOMC…)', 'Which red-folder events could move your pairs?', 2)}
        ${field('plan', 'Pre-market plan', 'Bias, key levels, setups to look for, max risk for the day…', 4)}
        ${field('review', 'End-of-day review', 'What happened? Did you follow your plan?', 4)}
        ${field('lessons', 'Lessons / one thing to improve tomorrow', 'Be specific.', 2)}
      </div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>This day's trades</h3><span class="${cls(m.net)} num"><b>${day.length ? money(m.net, { sign: true }) : ''}</b></span></div>
          ${day.length ? `<table><tbody>${day.map((t) => `<tr class="click" data-act="edit-trade" data-id="${esc(t.id)}"><td>${esc(t.instrument)} <span class="badge ${t.direction}">${t.direction === 'short' ? 'Short' : 'Long'}</span></td><td class="r ${cls(t.c.net)}">${t.c.closed ? money(t.c.net, { sign: true }) : 'Open'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty small">No trades logged this day.</div>'}
          <button class="btn sm" style="margin-top:10px" data-act="add-trade-day">+ Add trade for this day</button></div>
        <div class="card"><div class="card-h"><h3>Recent entries</h3></div>
          ${recent.length ? recent.map((x) => `<div class="entry ${x.id === d ? 'on' : ''}" data-act="j-open" data-day="${esc(x.id)}"><span>${fmtDay(x.id)}</span><span class="muted">${esc(x.mood || '')}</span></div>`).join('') : '<div class="empty small">Your written entries will appear here.</div>'}</div>
      </div>
    </div>`;
  return {
    html,
    mount() {
      const gather = () => Object.fromEntries($$('.jr').map((el) => [el.dataset.k, el.value]));
      const queue = () => { jPending = { date: d, data: gather() }; $('#jSaved').textContent = 'Saving…'; clearTimeout(jTimer); jTimer = setTimeout(flushJournal, 700); };
      $$('.jr').forEach((el) => { el.addEventListener('input', queue); el.addEventListener('blur', flushJournal); });
      $('#jDate').addEventListener('change', (e) => { if (e.target.value) { flushJournal(); S.jDate = e.target.value; render(); } });
    },
  };
}

/* ---------------- Reports ---------------- */
const DIMS = {
  instrument: { label: 'Instrument', fn: (t) => t.instrument },
  session: { label: 'Session', fn: (t) => t.session, order: SESSIONS },
  weekday: { label: 'Weekday', fn: (t) => WEEKDAYS[(new Date(t.day + 'T00:00').getDay() + 6) % 7], order: WEEKDAYS },
  hour: { label: 'Hour of entry', fn: (t) => (t.openTime ? t.openTime.slice(11, 13) + ':00' : ''), sort: 'key' },
  setup: { label: 'Setup', fn: (t) => t.setup },
  direction: { label: 'Long vs short', fn: (t) => (t.direction === 'short' ? 'Short' : 'Long') },
  tag: { label: 'Tag', fn: (t) => t.tags || [] },
  mistake: { label: 'Mistake', fn: (t) => t.mistake },
  emotion: { label: 'Emotion', fn: (t) => t.emotion },
  timeframe: { label: 'Timeframe', fn: (t) => t.timeframe },
  bias: { label: 'HTF bias', fn: (t) => t.bias },
  rules: { label: 'Followed rules', fn: (t) => (t.followed === true ? 'Followed' : t.followed === false ? 'Broke rules' : '') },
  account: { label: 'Account', fn: (t) => accName(t.accountId) },
};
function viewReports() {
  if (!S.trades.length) return { html: emptyState(false) };
  const { ts } = ctx();
  const dim = DIMS[S.repDim] || DIMS.instrument;
  let rows = breakdown(ts, dim.fn);
  if (dim.order) rows.sort((a, b) => dim.order.indexOf(a.key) - dim.order.indexOf(b.key));
  else if (dim.sort === 'key') rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  else rows.sort((a, b) => b.net - a.net);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const best = [...rows].sort((a, b) => b.net - a.net)[0], worst = [...rows].sort((a, b) => a.net - b.net)[0];
  const insight = rows.length > 1 && best.net > 0 ? `Best: <b>${esc(best.key)}</b> (${money(best.net, { sign: true })})${worst.net < 0 ? ` · Weakest: <b>${esc(worst.key)}</b> (${money(worst.net, { sign: true })})` : ''}` : '';
  const html = `<div class="page-h"><h2>Reports</h2><span class="muted">${insight}</span></div>
    <div class="chips">${Object.entries(DIMS).map(([k, d]) => `<button class="chip ${S.repDim === k ? 'on' : ''}" data-act="dim" data-k="${k}">${d.label}</button>`).join('')}</div>
    <div class="card"><div class="tbl-wrap"><table><thead><tr><th>${dim.label}</th><th class="r">Trades</th><th class="r">Win %</th><th class="r hide-m">Profit factor</th><th class="r hide-m">Avg R</th><th class="r hide-m">Avg / trade</th><th class="r">Net P&amp;L</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((r) => `<tr><td><b>${esc(r.key)}</b></td><td class="r">${r.n}</td><td class="r">${pct(r.winRate)}</td><td class="r hide-m">${f2(r.pf)}</td><td class="r hide-m">${r.avgR == null ? '—' : r.avgR.toFixed(2)}</td><td class="r hide-m ${cls(r.avg)}">${money(r.avg, { sign: true })}</td><td class="r ${cls(r.net)}"><b>${money(r.net, { sign: true })}</b></td>
      <td style="width:30%"><div class="bar"><i style="width:${(Math.abs(r.net) / max) * 100}%;background:var(${r.net >= 0 ? '--win' : '--loss'})"></i></div></td></tr>`).join('') : `<tr><td colspan="8"><div class="empty small">No data for this breakdown yet. Fill in the matching field when you log trades.</div></td></tr>`}
    </tbody></table></div></div>`;
  return { html };
}

/* ---------------- Accounts ---------------- */
function viewAccounts() {
  const inst = instMap();
  const calc = (list) => {
    const ts = S.trades.filter((t) => list.some((a) => a.id === t.accountId)).map((t) => enrich(t, inst));
    const s = summarize(ts, 0);
    return { ...s, start: sum(list.map((a) => +a.startBalance || 0)) };
  };
  const card = (a, s, all) => `<div class="card acc"><h3><span>${esc(a.name)}</span>${all ? '' : `<span class="badge">${esc(a.type || 'Live')}</span>`}</h3>
    <div class="bal">${money(s.start + s.net)}</div><div class="${cls(s.net)} num">${money(s.net, { sign: true })} <span class="muted">${s.start ? '(' + ((s.net / s.start) * 100).toFixed(1) + '%)' : ''}</span></div>
    <div class="row"><span>Starting balance</span><span class="num">${money(s.start)}</span></div>
    <div class="row"><span>Trades</span><span class="num">${s.n}</span></div><div class="row"><span>Win rate</span><span class="num">${pct(s.winRate)}</span></div>
    <div class="row"><span>Profit factor</span><span class="num">${f2(s.pf)}</span></div>
    ${all ? '' : `<div class="act"><button class="btn sm" data-act="view-acc" data-id="${esc(a.id)}">View stats</button><button class="btn sm" data-act="edit-account" data-id="${esc(a.id)}">Edit</button><button class="btn sm danger" data-act="del-account" data-id="${esc(a.id)}">Delete</button></div>`}</div>`;
  const total = S.accounts.length > 1 ? card({ name: 'All accounts combined' }, calc(S.accounts), true) : '';
  const html = `<div class="page-h"><h2>Trading accounts</h2><button class="btn primary" data-act="add-account">+ Add account</button></div>
    ${S.accounts.length ? `<div class="grid acc-grid">${total}${S.accounts.map((a) => card(a, calc([a]))).join('')}</div>` : emptyState(false)}`;
  return { html };
}

/* ---------------- Settings ---------------- */
function viewSettings() {
  const p = S.prefs, acc = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : ACCENTS[0];
  const dark = p.theme !== 'light';
  const insts = instList();
  const html = `<div class="page-h"><h2>Settings</h2></div><div class="set">
    <div class="card"><div class="card-h"><h3>Appearance</h3></div>
      <div class="row"><div class="lbl">Theme</div><div class="seg"><button class="${dark ? 'on' : ''}" data-act="theme" data-v="dark">Dark</button><button class="${dark ? '' : 'on'}" data-act="theme" data-v="light">Light</button></div></div>
      <div class="row"><div class="lbl">Accent color<small>Buttons, charts and highlights</small></div>
        <div class="swatches">${ACCENTS.map((c) => `<button class="sw ${c.toLowerCase() === acc.toLowerCase() ? 'on' : ''}" style="background:${c}" data-act="accent" data-v="${c}" aria-label="Accent ${c}"></button>`).join('')}<input type="color" id="accentPick" data-pref="accent" value="${acc}" aria-label="Custom accent"></div></div>
      <div class="row"><div class="lbl">Background color<small>Used when there's no picture</small></div>
        <input type="color" data-pref="bgColor" value="${/^#[0-9a-f]{6}$/i.test(p.bgColor || '') ? p.bgColor : (dark ? '#0e1013' : '#f4f5f7')}" aria-label="Background color"><button class="btn sm" data-act="bg-color-reset">Reset</button></div>
      <div class="row"><div class="lbl">Background picture<small>Any photo, stored privately in your account</small></div>
        <div class="bg-prev" style="${S.bg ? `background-image:url('${S.bg.data}')` : ''}"></div>
        <button class="btn sm" data-act="bg-pick">Choose picture</button>${S.bg ? '<button class="btn sm danger" data-act="bg-remove">Remove</button>' : ''}<input type="file" id="bgFile" accept="image/*" hidden></div>
      <div class="row"><div class="lbl">Picture dimming<small>Higher = easier to read</small></div><input type="range" data-pref="dim" min="0" max="0.95" step="0.05" value="${p.dim == null ? 0.6 : p.dim}" style="max-width:220px"></div>
      <div class="row"><div class="lbl">Picture blur</div><input type="range" data-pref="blur" min="0" max="20" step="1" value="${p.blur || 0}" style="max-width:220px"></div>
    </div>
    <div class="card"><div class="card-h"><h3>General</h3></div>
      <div class="row"><div class="lbl">Account currency<small>Shown next to all amounts (3-letter code)</small></div><input data-pref="currency" maxlength="3" value="${esc(p.currency || 'USD')}" style="width:90px;text-transform:uppercase"></div></div>
    <div class="card"><div class="card-h"><h3>Instruments</h3><button class="btn sm" data-act="inst-add">+ Add</button></div>
      <p class="muted tiny" style="margin-top:0">Used to turn prices into pips/points and dollars. <b>Pip size</b> = price move of 1 pip (EURUSD 0.0001, gold 0.1, NAS100 1). <b>Pip value</b> = what 1 pip is worth for 1.00 lot in your account currency. Check both with your broker. If you type the broker's P&amp;L in a trade, that always wins.</p>
      <div id="instTable">${insts.map((i, n) => `<div class="inst-row" data-i="${n}"><input class="in-name" value="${esc(i.name)}" placeholder="Symbol" aria-label="Symbol"><input class="in-pip" type="number" step="any" value="${i.pip}" aria-label="Pip size"><input class="in-val" type="number" step="any" value="${i.pipValue}" aria-label="Pip value"><input class="in-dp" type="number" step="1" min="0" max="6" value="${i.dp ?? 5}" aria-label="Decimals"><button class="btn sm danger" data-act="inst-del" data-i="${n}">✕</button></div>`).join('')}
      <div class="inst-row tiny muted" style="margin-top:-4px"><span>Symbol</span><span>Pip size</span><span>Pip value / lot</span><span>Decimals</span><span></span></div></div></div>
    <div class="card"><div class="card-h"><h3>Install as an app</h3></div>
      <div class="row"><div class="lbl">Add FTM Journal to your phone or computer<small>${esc(installHint())}</small></div>${S.installEvt ? '<button class="btn sm primary" data-act="install">Install</button>' : ''}</div></div>
    <div class="card"><div class="card-h"><h3>Your data</h3></div>
      <div class="row"><div class="lbl">Export trades<small>Opens in Excel / Google Sheets</small></div><button class="btn sm" data-act="export-csv">Download CSV</button></div>
      <div class="row"><div class="lbl">Full backup<small>Accounts, trades, journal, settings (no screenshots)</small></div><button class="btn sm" data-act="export-json">Download backup</button><button class="btn sm" data-act="restore-pick">Restore backup</button><input type="file" id="restoreFile" accept=".json,application/json" hidden></div>
      <div class="row"><div class="lbl">Import trades from CSV<small>Our CSV format or a broker export (best effort)</small></div>
        <select id="impAcc" style="width:auto">${S.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select><button class="btn sm" data-act="import-pick">Choose file</button><input type="file" id="csvFile" accept=".csv,.tsv,.txt,text/csv" hidden></div>
      ${S.user.demo ? `<div class="row"><div class="lbl">Sample data<small>Fill the demo with example trades</small></div><button class="btn sm" data-act="sample">Load sample data</button></div>` : ''}</div>
    <div class="card"><div class="card-h"><h3>Account</h3></div>
      <div class="row"><div class="lbl">${esc(S.user.name)}<small>${esc(S.user.email || 'Demo mode')}</small></div><button class="btn sm" data-act="signout">Sign out</button></div></div>
  </div>`;
  return { html };
}

function installHint() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'You are using the installed app.';
  if (S.installEvt) return 'One tap: it gets its own icon and opens full screen.';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return 'In Safari tap the Share button, then "Add to Home Screen".';
  return 'In Chrome or Edge open the browser menu and choose "Install app" or "Add to Home screen".';
}

const VIEWS = { dashboard: viewDashboard, trades: viewTrades, journal: viewJournal, reports: viewReports, accounts: viewAccounts, settings: viewSettings };

/* =====================================================================
   Modals
   ===================================================================== */
let escHandler = null, pasteHandler = null;
function openModal(html, { narrow = false } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" id="ov"><div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  $('#ov').addEventListener('mousedown', (e) => { if (e.target.id === 'ov') closeModal(); });
  escHandler = (e) => { if (e.key === 'Escape') { if ($('.lightbox')) $('.lightbox').remove(); else closeModal(); } };
  document.addEventListener('keydown', escHandler);
  document.body.style.overflow = 'hidden';
  return $('.modal', root);
}
function closeModal() {
  $('#modal-root').innerHTML = '';
  if (escHandler) document.removeEventListener('keydown', escHandler);
  if (pasteHandler) document.removeEventListener('paste', pasteHandler);
  escHandler = pasteHandler = null;
  document.body.style.overflow = '';
}
function showImg(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}" alt="Trade screenshot">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

/* ---------------- Account modal ---------------- */
function openAccount(id, first = false) {
  const a = id ? S.accounts.find((x) => x.id === id) : null;
  const m = openModal(`<div class="modal-h"><h2>${a ? 'Edit account' : first ? 'Create your first account' : 'New account'}</h2><button class="btn sm ghost" data-act="close">✕</button></div>
    ${first ? '<p class="muted" style="margin-top:0">Add the account you trade (live, demo or prop firm). You can add more later and view them one by one or all together.</p>' : ''}
    <form id="accForm" class="stack">
      <label class="f"><span>Account name</span><input name="name" required maxlength="40" placeholder="e.g. Live – Exness, FTMO 100k" value="${esc(a?.name || '')}"></label>
      <label class="f"><span>Type</span><select name="type">${ACC_TYPES.map((t) => `<option ${a?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="f"><span>Starting balance (${esc(S.prefs.currency || 'USD')})</span><input name="startBalance" type="number" step="any" min="0" value="${a?.startBalance ?? ''}" placeholder="10000"></label>
      <div class="modal-f"><span></span><div class="right"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${a ? 'Save' : 'Create account'}</button></div></div>
    </form>`, { narrow: true });
  $('input[name=name]', m).focus();
  $('#accForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = { name: fd.get('name').trim(), type: fd.get('type'), startBalance: numOrNull(fd.get('startBalance')) || 0, createdAt: a?.createdAt || Date.now() };
    if (!obj.name) return;
    const nid = a?.id || store.newId();
    safe(async () => { await store.set('accounts', nid, obj); closeModal(); toast(a ? 'Account updated' : 'Account created'); if (!a && S.scope === 'all' && S.accounts.length === 0) { /* keep All */ } }, 'Could not save account');
  });
}

async function deleteAccount(id) {
  const a = S.accounts.find((x) => x.id === id);
  if (!a) return;
  const mine = S.trades.filter((t) => t.accountId === id);
  if (!confirm(`Delete "${a.name}" and its ${mine.length} trade${mine.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
  await safe(async () => {
    for (const t of mine) { await Promise.all((t.shots || []).map((s) => store.del('shots', s))); await store.del('trades', t.id); }
    await store.del('accounts', id);
    toast('Account deleted');
  }, 'Could not delete account');
}

/* ---------------- Images ---------------- */
function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
    img.src = url;
  });
}
async function compress(file, { max = 1400, q = 0.72, limit = 850000 } = {}) {
  const img = await loadImg(file);
  let scale = Math.min(1, max / Math.max(img.width, img.height)), data = '';
  for (let i = 0; i < 8; i++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    data = c.toDataURL('image/jpeg', q);
    if (data.length <= limit) return data;
    q = Math.max(0.45, q - 0.1); scale *= 0.85;
  }
  return data;
}

/* ---------------- Trade modal ---------------- */
function openTrade(id, presetDay) {
  if (!S.accounts.length) { toast('Create an account first'); openAccount(null, true); return; }
  const edit = id ? S.trades.find((t) => t.id === id) : null;
  const insts = instList();
  const nowIn = presetDay ? `${presetDay}T09:00` : toLocalInput(new Date());
  const t = edit ? { ...edit } : { accountId: S.scope !== 'all' ? S.scope : S.accounts[0].id, instrument: insts[0]?.name || '', direction: 'long', openTime: nowIn, closeTime: '', rating: 0, followed: true, tags: [], shots: [] };
  const setups = uniq([...SETUP_HINTS, ...S.trades.map((x) => x.setup)]);
  const mistakes = uniq([...MISTAKE_HINTS, ...S.trades.map((x) => x.mistake)]);
  const emotions = uniq([...EMOTION_HINTS, ...S.trades.map((x) => x.emotion)]);
  let rating = t.rating || 0;
  let pending = []; // {id,data,isNew}
  const v = (x) => (x == null ? '' : esc(x));
  const num = (name, label, cl, ph = '') => `<label class="f ${cl}"><span>${label}</span><input name="${name}" type="number" step="any" inputmode="decimal" value="${v(t[name])}" placeholder="${ph}"></label>`;

  const m = openModal(`<div class="modal-h"><h2>${edit ? 'Edit trade' : 'Add trade'}</h2><button class="btn sm ghost" data-act="close" aria-label="Close">✕</button></div>
  <form id="tf" class="form" autocomplete="off">
    <label class="f c3"><span>Account</span><select name="accountId">${S.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f c3"><span>Instrument</span><select name="instrument">${uniq([...insts.map((i) => i.name), t.instrument]).map((i) => `<option ${i === t.instrument ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select></label>
    <div class="f c2"><span class="muted tiny" style="display:block;margin-bottom:4px">Direction</span><div class="dir"><label><input type="radio" name="direction" value="long" ${t.direction !== 'short' ? 'checked' : ''}><span class="long">Long</span></label><label><input type="radio" name="direction" value="short" ${t.direction === 'short' ? 'checked' : ''}><span class="short">Short</span></label></div></div>
    ${num('lots', 'Lots', 'c2', '0.10')}
    <label class="f c2"><span>Timeframe</span><select name="timeframe"><option value="">—</option>${TIMEFRAMES.map((x) => `<option ${t.timeframe === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="f c3"><span>Opened</span><input name="openTime" type="datetime-local" required value="${v(t.openTime)}"></label>
    <label class="f c3"><span>Closed</span><input name="closeTime" type="datetime-local" value="${v(t.closeTime)}"></label>
    ${num('entry', 'Entry price', 'c2')}${num('sl', 'Stop loss', 'c2')}${num('tp', 'Take profit', 'c2')}
    ${num('exit', 'Exit price', 'c2')}${num('gross', 'P&L from broker (optional)', 'c2', 'auto')}${num('fees', 'Fees: commission + swap', 'c2', '0')}
    <div class="c6 preview" id="pv"></div>
    <label class="f c2"><span>Setup / strategy</span><input name="setup" list="dl-setup" value="${v(t.setup)}" placeholder="e.g. Liquidity sweep"></label>
    <label class="f c2"><span>Mistake (if any)</span><input name="mistake" list="dl-mistake" value="${v(t.mistake)}" placeholder="None"></label>
    <label class="f c2"><span>Emotion</span><input name="emotion" list="dl-emotion" value="${v(t.emotion)}"></label>
    <label class="f c2"><span>Higher-timeframe bias</span><select name="bias"><option value="">—</option>${BIAS.map((x) => `<option ${t.bias === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="f c4"><span>Tags (comma separated)</span><input name="tags" value="${v((t.tags || []).join(', '))}" placeholder="A+ setup, news, london open"></label>
    <div class="f c3"><span class="muted tiny" style="display:block;margin-bottom:4px">Execution rating</span><div class="rate" id="rate"></div></div>
    <label class="f c3" style="display:flex;align-items:center;gap:8px;padding-top:18px"><input type="checkbox" name="followed" ${t.followed !== false ? 'checked' : ''}> <span style="margin:0;font-size:14px;color:var(--text)">I followed my trading rules</span></label>
    <label class="f c6"><span>News / context</span><input name="news" value="${v(t.news)}" placeholder="e.g. FOMC at 21:00, CPI day"></label>
    <label class="f c6"><span>Notes</span><textarea name="notes" rows="3" placeholder="Why did you take it? What did you see? What would you do differently?">${esc(t.notes || '')}</textarea></label>
    <div class="c6"><span class="muted tiny" style="display:block;margin-bottom:6px">Screenshots <span class="tiny">(click ＋, drag a file in, or paste with Ctrl+V)</span></span><div class="shots" id="shots"></div><input type="file" id="shotFile" accept="image/*" multiple hidden></div>
    <datalist id="dl-setup">${setups.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-mistake">${mistakes.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="dl-emotion">${emotions.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="c6 modal-f" style="margin-top:4px">${edit ? '<button type="button" class="btn danger" id="delTrade">Delete trade</button>' : '<span></span>'}<div class="right"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit" id="saveTrade">${edit ? 'Save changes' : 'Save trade'}</button></div></div>
  </form>`);

  const form = $('#tf', m);
  const read = () => {
    const fd = new FormData(form), g = (k) => (fd.get(k) ?? '').toString().trim();
    return {
      accountId: g('accountId'), instrument: g('instrument'), direction: g('direction') || 'long',
      lots: numOrNull(g('lots')), timeframe: g('timeframe'), openTime: g('openTime'), closeTime: g('closeTime'),
      entry: numOrNull(g('entry')), sl: numOrNull(g('sl')), tp: numOrNull(g('tp')), exit: numOrNull(g('exit')),
      gross: numOrNull(g('gross')), fees: numOrNull(g('fees')), setup: g('setup'), mistake: g('mistake'), emotion: g('emotion'),
      bias: g('bias'), tags: g('tags').split(',').map((x) => x.trim()).filter(Boolean), rating, followed: fd.get('followed') === 'on',
      news: g('news'), notes: g('notes'),
    };
  };
  const preview = () => {
    const f = read(), c = computeTrade(f, instMap());
    const cell = (l, val, c2 = '') => `<div><small>${l}</small><b class="${c2}">${val}</b></div>`;
    $('#pv', m).innerHTML = cell('Pips / points', c.pips == null ? '—' : c.pips.toFixed(1)) +
      cell(c.grossAuto ? 'Gross (auto)' : 'Gross', c.gross == null ? '—' : money(c.gross, { sign: true }), cls(c.gross)) +
      cell('Net P&L', c.net == null ? 'Open' : money(c.net, { sign: true }), cls(c.net)) +
      cell('Risk', c.risk == null ? '—' : money(c.risk)) + cell('R multiple', c.r == null ? '—' : c.r.toFixed(2) + 'R', cls(c.r)) +
      cell('Planned R:R', c.rr == null ? '—' : '1 : ' + c.rr.toFixed(2)) + cell('Session', sessionOf(f.openTime));
  };
  const drawRate = () => { $('#rate', m).innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= rating ? 'on' : ''}" data-r="${n}" aria-label="${n} star">★</button>`).join(''); };
  const drawShots = () => {
    $('#shots', m).innerHTML = pending.map((p, i) => `<div class="thumb" data-i="${i}">${p.data ? `<img src="${p.data}" alt="Screenshot ${i + 1}">` : ''}<button type="button" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('') + `<button type="button" class="add-shot" id="addShot">＋<br>Add</button>`;
  };
  const addFiles = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      await safe(async () => { pending.push({ id: store.newId(), data: await compress(f), isNew: true }); drawShots(); }, 'Could not add image');
    }
  };
  drawRate(); preview(); drawShots();
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  $('#rate', m).addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; rating = rating === +b.dataset.r ? 0 : +b.dataset.r; drawRate(); });
  $('#shots', m).addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { pending.splice(+rm.dataset.rm, 1); drawShots(); return; }
    if (e.target.closest('#addShot')) { $('#shotFile', m).click(); return; }
    const th = e.target.closest('.thumb');
    if (th && pending[+th.dataset.i]?.data) showImg(pending[+th.dataset.i].data);
  });
  $('#shotFile', m).addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  m.addEventListener('dragover', (e) => e.preventDefault());
  m.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
  pasteHandler = (e) => { const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addFiles(fs); } };
  document.addEventListener('paste', pasteHandler);

  // load existing screenshots
  if (edit && (edit.shots || []).length) {
    pending = edit.shots.map((sid) => ({ id: sid, data: null, isNew: false }));
    drawShots();
    pending.forEach((p) => store.get('shots', p.id).then((d) => { p.data = d?.data || ''; if ($('#shots')) drawShots(); }).catch(() => {}));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = read();
    if (!f.instrument || !f.openTime) { toast('Instrument and open time are required', true); return; }
    const btn = $('#saveTrade', m); btn.disabled = true;
    const tid = edit?.id || store.newId();
    const obj = { ...f, shots: pending.map((p) => p.id), updatedAt: Date.now(), createdAt: edit?.createdAt || Date.now() };
    const keep = new Set(obj.shots), dropped = (edit?.shots || []).filter((x) => !keep.has(x));
    safe(async () => {
      await Promise.all(pending.filter((p) => p.isNew && p.data).map((p) => store.set('shots', p.id, { data: p.data, tradeId: tid, createdAt: Date.now() })));
      await store.set('trades', tid, obj);
      await Promise.all(dropped.map((x) => store.del('shots', x)));
      closeModal(); toast(edit ? 'Trade updated' : 'Trade saved');
    }, 'Could not save trade').finally(() => { btn.disabled = false; });
  });
  const del = $('#delTrade', m);
  if (del) del.addEventListener('click', () => {
    if (!confirm('Delete this trade?')) return;
    safe(async () => { await Promise.all((edit.shots || []).map((x) => store.del('shots', x))); await store.del('trades', edit.id); closeModal(); toast('Trade deleted'); }, 'Could not delete trade');
  });
}

/* =====================================================================
   Import / export
   ===================================================================== */
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const CSV_COLS = ['account', 'openTime', 'closeTime', 'instrument', 'direction', 'lots', 'entry', 'sl', 'tp', 'exit', 'gross', 'fees', 'net', 'pips', 'r', 'session', 'timeframe', 'bias', 'setup', 'tags', 'mistake', 'emotion', 'followed', 'rating', 'news', 'notes'];
function exportCsv() {
  const inst = instMap();
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = S.trades.map((t) => enrich(t, inst)).sort((a, b) => a.ts - b.ts).map((t) => CSV_COLS.map((c) => {
    if (c === 'account') return q(accName(t.accountId));
    if (c === 'net') return q(t.c.net == null ? '' : t.c.net.toFixed(2));
    if (c === 'pips') return q(t.c.pips == null ? '' : t.c.pips.toFixed(1));
    if (c === 'r') return q(t.c.r == null ? '' : t.c.r.toFixed(2));
    if (c === 'session') return q(t.session);
    if (c === 'tags') return q((t.tags || []).join('; '));
    if (c === 'followed') return q(t.followed === true ? 'yes' : t.followed === false ? 'no' : '');
    return q(t[c]);
  }).join(','));
  download(`ftm-journal-trades-${dayStr(new Date())}.csv`, [CSV_COLS.join(','), ...rows].join('\n'));
}
function exportJson() {
  download(`ftm-journal-backup-${dayStr(new Date())}.json`, JSON.stringify({ app: 'ftm-journal', version: 1, exportedAt: new Date().toISOString(), accounts: S.accounts, trades: S.trades, journal: Object.values(S.journal), prefs: S.prefs, instruments: instList() }, null, 1), 'application/json');
}
async function restoreJson(file) {
  const d = JSON.parse(await file.text());
  if (d.app !== 'ftm-journal') throw new Error('This is not an FTM Journal backup');
  if (!confirm(`Restore ${d.accounts?.length || 0} accounts and ${d.trades?.length || 0} trades? Existing items with the same ID are overwritten.`)) return;
  for (const a of d.accounts || []) { const { id, ...r } = a; await store.set('accounts', id, r); }
  for (const t of d.trades || []) { const { id, ...r } = t; await store.set('trades', id, r); }
  for (const j of d.journal || []) { const { id, ...r } = j; await store.set('journal', id, r); }
  if (d.instruments) await store.set('settings', 'instruments', { list: d.instruments });
  if (d.prefs) await store.set('settings', 'prefs', d.prefs, true);
  toast('Backup restored');
}
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const ALIAS = {
  opentime: 'openTime', opendate: 'openTime', date: 'openTime', time: 'openTime', entrytime: 'openTime', opentimeutc: 'openTime',
  closetime: 'closeTime', closedate: 'closeTime', exittime: 'closeTime',
  instrument: 'instrument', symbol: 'instrument', pair: 'instrument', market: 'instrument',
  direction: 'direction', type: 'direction', side: 'direction', action: 'direction',
  lots: 'lots', volume: 'lots', size: 'lots', lotsize: 'lots', quantity: 'lots',
  entry: 'entry', openprice: 'entry', entryprice: 'entry', price: 'entry',
  sl: 'sl', stoploss: 'sl', stop: 'sl', tp: 'tp', takeprofit: 'tp', target: 'tp',
  exit: 'exit', closeprice: 'exit', exitprice: 'exit',
  gross: 'gross', profit: 'gross', pnl: 'gross', pl: 'gross', netpl: 'gross', result: 'gross',
  fees: 'fees', commission: 'commission', swap: 'swap',
  timeframe: 'timeframe', bias: 'bias', setup: 'setup', strategy: 'setup', tags: 'tags', mistake: 'mistake', emotion: 'emotion',
  followed: 'followed', rating: 'rating', news: 'news', notes: 'notes', comment: 'notes',
};
function normTime(s) {
  s = (s || '').trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T09:00';
  const d = new Date(s);
  return isNaN(d) ? '' : toLocalInput(d);
}
async function importCsv(file, accountId) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('The file looks empty');
  const head = rows[0].map((h) => ALIAS[h.toLowerCase().replace(/[^a-z]/g, '')] || null);
  if (!head.includes('instrument')) throw new Error('No "instrument" or "symbol" column found');
  const known = new Set(instList().map((i) => i.name));
  let ok = 0, unknown = new Set();
  for (const r of rows.slice(1)) {
    const o = {};
    head.forEach((k, i) => { if (k && o[k] === undefined) o[k] = (r[i] ?? '').trim(); });
    const instrument = (o.instrument || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const openTime = normTime(o.openTime);
    if (!instrument || !openTime) continue;
    if (!known.has(instrument)) unknown.add(instrument);
    const fees = o.fees !== undefined ? numOrNull(o.fees) : (Math.abs(numOrNull(o.commission) || 0) + Math.abs(Math.min(0, numOrNull(o.swap) || 0)) - Math.max(0, numOrNull(o.swap) || 0)) || null;
    const obj = {
      accountId, instrument, openTime, closeTime: normTime(o.closeTime), direction: /sell|short/i.test(o.direction || '') ? 'short' : 'long',
      lots: numOrNull(o.lots), entry: numOrNull(o.entry), sl: numOrNull(o.sl), tp: numOrNull(o.tp), exit: numOrNull(o.exit), gross: numOrNull(o.gross), fees,
      timeframe: o.timeframe || '', bias: o.bias || '', setup: o.setup || '', mistake: o.mistake || '', emotion: o.emotion || '',
      tags: (o.tags || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean), followed: /^(yes|true|1)$/i.test(o.followed || '') ? true : /^(no|false|0)$/i.test(o.followed || '') ? false : undefined,
      rating: numOrNull(o.rating) || 0, news: o.news || '', notes: o.notes || '', shots: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    await store.set('trades', store.newId(), obj);
    ok++;
  }
  toast(`Imported ${ok} trade${ok === 1 ? '' : 's'}`);
  if (unknown.size) setTimeout(() => toast(`Add pip sizes in Settings for: ${[...unknown].join(', ')}`, true), 2800);
}

/* =====================================================================
   Sample data (demo only)
   ===================================================================== */
async function loadSample() {
  let seed = 42;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let accs = S.accounts;
  if (!accs.length) {
    const a1 = { name: 'Live – Main', type: 'Live', startBalance: 5000, createdAt: Date.now() }, a2 = { name: 'Prop – 10k', type: 'Prop firm', startBalance: 10000, createdAt: Date.now() + 1 };
    const i1 = store.newId(), i2 = store.newId();
    await store.set('accounts', i1, a1); await store.set('accounts', i2, a2);
    accs = [{ id: i1 }, { id: i2 }];
  }
  const base = { GBPUSD: 1.27, EURUSD: 1.08, XAUUSD: 2650, NAS100: 20500 };
  const spec = { GBPUSD: [12, 40, 8, 22], EURUSD: [10, 35, 8, 20], XAUUSD: [40, 140, 25, 70], NAS100: [30, 120, 20, 60] };
  const meta = instMap();
  const setups = ['Liquidity sweep', 'Breakout', 'Pullback', 'Reversal'], mist = ['FOMO', 'Moved stop loss', 'Exited early', 'Revenge trade'], emo = ['Calm', 'Confident', 'Anxious', 'Greedy'];
  const today = new Date();
  for (let d = 90; d >= 0; d--) {
    const day = new Date(today); day.setDate(today.getDate() - d);
    if (day.getDay() === 0 || day.getDay() === 6 || rnd() < 0.25) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const ins = pick(Object.keys(base)), i = meta[ins], dir = rnd() < 0.55 ? 'long' : 'short', s = dir === 'long' ? 1 : -1;
      const win = rnd() < 0.52, [wmin, wmax, lmin, lmax] = spec[ins];
      const slP = lmin + rnd() * (lmax - lmin), outP = win ? wmin + rnd() * (wmax - wmin) : -(lmin + rnd() * (slP - lmin));
      const entry = base[ins] * (1 + (rnd() - 0.5) * 0.02), dp = i.dp;
      const px = (p) => +(entry + s * p * i.pip).toFixed(dp);
      const h = 7 + Math.floor(rnd() * 13), open = new Date(day); open.setHours(h, Math.floor(rnd() * 60));
      const close = new Date(open.getTime() + (10 + rnd() * 180) * 60000);
      const lots = +(0.1 + Math.floor(rnd() * 6) * 0.1).toFixed(2);
      const bad = !win && rnd() < 0.45;
      await store.set('trades', store.newId(), {
        accountId: pick(accs).id, instrument: ins, direction: dir, lots, openTime: toLocalInput(open), closeTime: toLocalInput(close), timeframe: pick(['M5', 'M15', 'H1']),
        entry: +entry.toFixed(dp), sl: px(-slP), tp: px(slP * 2), exit: px(outP), gross: null, fees: +(lots * 0.7).toFixed(2), bias: pick(['Bullish', 'Bearish', 'Range']),
        setup: pick(setups), mistake: bad ? pick(mist) : '', emotion: pick(emo), tags: rnd() < 0.3 ? ['A+ setup'] : [], followed: !bad, rating: 1 + Math.floor(rnd() * 5),
        news: '', notes: win ? 'Waited for confirmation and followed the plan.' : 'Stopped out. Review entry timing.', shots: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
  }
  toast('Sample data loaded');
}

/* =====================================================================
   Events
   ===================================================================== */
const ACTIONS = {
  nav: (el) => { if (S.tab === 'journal') flushJournal(); S.tab = el.dataset.tab; lsSet('tab', S.tab); render(); window.scrollTo(0, 0); },
  close: () => closeModal(),
  'add-trade': () => openTrade(),
  'add-trade-day': () => openTrade(null, S.jDate),
  'edit-trade': (el) => openTrade(el.dataset.id),
  'add-account': () => openAccount(),
  'edit-account': (el) => openAccount(el.dataset.id),
  'del-account': (el) => deleteAccount(el.dataset.id),
  'view-acc': (el) => { S.scope = el.dataset.id; lsSet('scope', S.scope); S.tab = 'dashboard'; lsSet('tab', 'dashboard'); render(); },
  'cal-prev': () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() - 1, 1); render(); },
  'cal-next': () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + 1, 1); render(); },
  'cal-day': (el) => { S.jDate = el.dataset.day; S.tab = 'journal'; lsSet('tab', 'journal'); render(); },
  'j-prev': () => { flushJournal(); const d = new Date(S.jDate + 'T00:00'); d.setDate(d.getDate() - 1); S.jDate = dayStr(d); render(); },
  'j-next': () => { flushJournal(); const d = new Date(S.jDate + 'T00:00'); d.setDate(d.getDate() + 1); S.jDate = dayStr(d); render(); },
  'j-today': () => { flushJournal(); S.jDate = dayStr(new Date()); render(); },
  'j-open': (el) => { flushJournal(); S.jDate = el.dataset.day; render(); },
  dim: (el) => { S.repDim = el.dataset.k; lsSet('repDim', S.repDim); render(); },
  theme: (el) => { savePrefs({ theme: el.dataset.v }); render(); },
  accent: (el) => { savePrefs({ accent: el.dataset.v }); render(); },
  'bg-color-reset': () => { savePrefs({ bgColor: '' }); render(); },
  'bg-pick': () => $('#bgFile').click(),
  'bg-remove': () => safe(async () => { S.bg = null; applyPrefs(); await store.del('settings', 'bg'); toast('Background removed'); }),
  'inst-add': () => { S.instList = [...instList(), { name: 'NEWPAIR', pip: 0.0001, pipValue: 10, dp: 5 }]; saveInst(); render(); },
  'inst-del': (el) => { S.instList = instList().filter((_, i) => i !== +el.dataset.i); saveInst(); render(); },
  'export-csv': () => exportCsv(),
  'export-json': () => exportJson(),
  'restore-pick': () => $('#restoreFile').click(),
  'import-pick': () => { if (!S.accounts.length) return toast('Create an account first', true); $('#csvFile').click(); },
  sample: () => safe(loadSample, 'Could not load sample'),
  signout: () => safe(() => store.signOut()),
  install: async () => { const e = S.installEvt; if (!e) return; e.prompt(); await e.userChoice.catch(() => {}); S.installEvt = null; render(); },
};
function saveInst() { safe(() => store.set('settings', 'instruments', { list: instList() }), 'Could not save instruments'); }

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

// Settings inputs
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.pref) {
    const k = el.dataset.pref;
    if (k === 'currency') { const v = el.value.toUpperCase().replace(/[^A-Z]/g, ''); if (v.length === 3) { try { new Intl.NumberFormat(undefined, { style: 'currency', currency: v }); savePrefs({ currency: v }); } catch { /* invalid code */ } } return; }
    const val = k === 'dim' || k === 'blur' ? +el.value : el.value;
    savePrefs({ [k]: val });
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.closest && el.closest('#instTable')) {
    S.instList = $$('#instTable .inst-row[data-i]').map((r) => ({
      name: $('.in-name', r).value.toUpperCase().replace(/[^A-Z0-9]/g, ''), pip: +$('.in-pip', r).value || 0.0001, pipValue: +$('.in-val', r).value || 1, dp: Math.max(0, Math.min(6, +$('.in-dp', r).value || 0)),
    })).filter((i) => i.name);
    saveInst(); toast('Instruments saved');
  }
  if (el.id === 'bgFile' && el.files[0]) {
    safe(async () => {
      const data = await compress(el.files[0], { max: 1920, q: 0.7, limit: 900000 });
      S.bg = { data }; applyPrefs(); await store.set('settings', 'bg', { data }); toast('Background updated'); render();
    }, 'Could not set background');
    el.value = '';
  }
  if (el.id === 'csvFile' && el.files[0]) { const f = el.files[0], acc = $('#impAcc').value; el.value = ''; safe(() => importCsv(f, acc), 'Import failed'); }
  if (el.id === 'restoreFile' && el.files[0]) { const f = el.files[0]; el.value = ''; safe(() => restoreJson(f), 'Restore failed'); }
});

// Top bar filters
$('#scopeSel').addEventListener('change', (e) => { S.scope = e.target.value; lsSet('scope', S.scope); render(); });
$('#periodSel').addEventListener('change', (e) => { S.period = e.target.value; lsSet('period', S.period); render(); });
window.addEventListener('beforeunload', flushJournal);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; render(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('App installed'); render(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));

/* =====================================================================
   Boot
   ===================================================================== */
function showLogin(err) {
  $('#boot').hidden = true; $('#shell').hidden = true; $('#login').hidden = false;
  $('#googleBtn').hidden = !store.cloudReady;
  $('#setupNotice').hidden = store.cloudReady;
  const el = $('#loginErr'); el.hidden = !err; el.textContent = err || '';
}
function onAuth(user) {
  $('#boot').hidden = true;
  if (user) {
    S.user = user;
    $('#login').hidden = true; $('#shell').hidden = false;
    startData(); render();
  } else {
    S.user = null; stopData(); closeModal(); showLogin();
  }
}
$('#googleBtn').addEventListener('click', async () => {
  const b = $('#googleBtn'); b.disabled = true;
  try { await store.signInGoogle(); }
  catch (e) {
    console.error(e);
    showLogin(e.code === 'auth/unauthorized-domain' ? 'This website address is not authorised yet. Add it in Firebase > Authentication > Settings > Authorized domains.' : 'Sign-in failed: ' + (e.message || e.code));
  } finally { b.disabled = false; }
});
$('#demoBtn').addEventListener('click', () => store.startDemo());
store.onError((e) => toast(e.code === 'permission-denied' ? 'Permission denied. Publish the Firestore rules from the setup guide.' : 'Sync error: ' + (e.message || e.code), true));
store.init(onAuth).catch((e) => { console.error(e); $('#boot').hidden = true; showLogin('Could not load Firebase. Check your internet connection and firebase-config.js.'); });
