// Tiny dependency-free equity chart (SVG). Returns markup + a helper to place the hover marker.
export function equityChart(pts, base, w = 800, h = 240) {
  if (pts.length < 2) return { html: '<div class="empty small">Add closed trades to see your equity curve.</div>', pos: null };
  const pad = 10;
  const vals = pts.map((p) => p.bal).concat(base);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const X = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const Y = (v) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.bal).toFixed(1)}`).join(' ');
  const area = `${line} L${X(pts.length - 1).toFixed(1)} ${h} L${X(0).toFixed(1)} ${h} Z`;
  const by = Y(base).toFixed(1);
  const html = `<div class="eq" id="eq">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Equity curve">
      <defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity=".30"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#eqg)"/>
      <line x1="0" x2="${w}" y1="${by}" y2="${by}" stroke="var(--muted)" stroke-opacity=".45" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="eq-cur" hidden></div><div class="eq-dot" hidden></div>
  </div>`;
  const pos = (i) => ({ x: (X(i) / w) * 100, y: (Y(pts[i].bal) / h) * 100 });
  return { html, pos };
}
