// Trading maths: pips, P&L, R-multiple, sessions and performance statistics.

export const DEFAULT_INSTRUMENTS = [
  // pip = size of one pip/point in price. pipValue = account-currency value of 1 pip for 1.00 lot.
  // These are typical broker values - check yours in Settings > Instruments.
  { name: 'GBPUSD', pip: 0.0001, pipValue: 10, dp: 5 },
  { name: 'EURUSD', pip: 0.0001, pipValue: 10, dp: 5 },
  { name: 'XAUUSD', pip: 0.1, pipValue: 10, dp: 2 },
  { name: 'NAS100', pip: 1, pipValue: 1, dp: 1 },
];

export const SESSIONS = ['Asia', 'London', 'London/NY overlap', 'New York', 'After hours'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const sum = (a) => a.reduce((x, y) => x + y, 0);

export function computeTrade(t, instMap) {
  const i = instMap[t.instrument] || { pip: 0.0001, pipValue: 10 };
  const entry = num(t.entry), exit = num(t.exit), sl = num(t.sl), tp = num(t.tp);
  const lots = num(t.lots) || 0, fees = num(t.fees) || 0;
  const dir = t.direction === 'short' ? -1 : 1;
  const pips = entry != null && exit != null ? ((exit - entry) * dir) / i.pip : null;
  let gross = num(t.gross), grossAuto = false;
  if (gross == null && pips != null) { gross = pips * i.pipValue * lots; grossAuto = true; }
  const closed = gross != null;
  const net = closed ? gross - fees : null;
  const riskPips = entry != null && sl != null ? Math.abs(entry - sl) / i.pip : null;
  const risk = riskPips != null ? riskPips * i.pipValue * lots : null;
  const r = net != null && risk > 0 ? net / risk : null;
  const rr = entry != null && sl != null && tp != null && entry !== sl ? Math.abs(tp - entry) / Math.abs(entry - sl) : null;
  return { pips, gross, grossAuto, net, risk, riskPips, r, rr, closed };
}

// Session from the entry time (converted to UTC, so it is right wherever you are).
export function sessionOf(local) {
  if (!local) return '—';
  const d = new Date(local);
  if (isNaN(d)) return '—';
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h >= 12 && h < 16) return 'London/NY overlap';
  if (h >= 7 && h < 12) return 'London';
  if (h >= 16 && h < 21) return 'New York';
  if (h >= 0 && h < 7) return 'Asia';
  return 'After hours';
}

function quick(a) {
  const net = sum(a.map((t) => t.c.net));
  const wins = a.filter((t) => t.c.net > 0);
  const gp = sum(wins.map((t) => t.c.net));
  const gl = Math.abs(sum(a.filter((t) => t.c.net < 0).map((t) => t.c.net)));
  const rs = a.map((t) => t.c.r).filter((x) => x != null);
  return {
    n: a.length, net, wins: wins.length, winRate: a.length ? wins.length / a.length : 0,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : null,
    avgR: rs.length ? sum(rs) / rs.length : null, avg: a.length ? net / a.length : 0,
  };
}

export function breakdown(ts, keyFn) {
  const m = new Map();
  for (const t of ts) {
    if (!t.c.closed) continue;
    let ks = keyFn(t);
    if (!Array.isArray(ks)) ks = [ks];
    for (const k of ks) {
      if (k === '' || k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
  }
  return [...m].map(([key, a]) => ({ key, ...quick(a) }));
}

export function summarize(ts, start = 0) {
  const closed = ts.filter((t) => t.c.closed).sort((a, b) => a.ts - b.ts);
  const wins = closed.filter((t) => t.c.net > 0);
  const losses = closed.filter((t) => t.c.net < 0);
  const be = closed.length - wins.length - losses.length;
  const gp = sum(wins.map((t) => t.c.net));
  const gl = Math.abs(sum(losses.map((t) => t.c.net)));
  const net = gp - gl;
  const n = closed.length;

  let bal = start, peak = start, maxDD = 0, maxDDPct = 0;
  const curve = [{ ts: closed.length ? closed[0].ts - 1 : 0, bal: start, label: 'Start' }];
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const t of closed) {
    bal += t.c.net;
    curve.push({ ts: t.ts, bal, label: t.day });
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0 && dd / peak > maxDDPct) maxDDPct = dd / peak;
    if (t.c.net > 0) { curW++; curL = 0; } else if (t.c.net < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }
  const rs = closed.map((t) => t.c.r).filter((x) => x != null);
  const followed = closed.filter((t) => t.followed === true).length;
  const judged = closed.filter((t) => t.followed === true || t.followed === false).length;
  const byDay = {};
  for (const t of closed) {
    const d = (byDay[t.day] = byDay[t.day] || { net: 0, n: 0 });
    d.net += t.c.net; d.n++;
  }
  return {
    n, open: ts.length - n, wins: wins.length, losses: losses.length, be, net, gp, gl,
    winRate: n ? wins.length / n : null,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : null,
    avgWin: wins.length ? gp / wins.length : null,
    avgLoss: losses.length ? gl / losses.length : null,
    payoff: wins.length && losses.length ? gp / wins.length / (gl / losses.length) : null,
    expectancy: n ? net / n : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    maxDD, maxDDPct, maxW, maxL, curve, byDay, balance: bal,
    best: closed.length ? Math.max(...closed.map((t) => t.c.net)) : null,
    worst: closed.length ? Math.min(...closed.map((t) => t.c.net)) : null,
    discipline: judged ? followed / judged : null,
  };
}
