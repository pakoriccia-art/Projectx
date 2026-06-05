/**
 * PizzaMatrix — MiniHillCurve (Dashboard v4)
 * Curva di decadimento strutturale W(t) = W0 / (1 + (t/tCrit)^n) renderizzata in SVG.
 * Standalone, riusabile. Verde fino a t < tCrit·0.82, rossa oltre (zona collasso).
 * Dot di stato (grigio/verde/giallo/rosso) alla posizione corrente.
 */
const HILL_EXPONENT = 5;
const COLLAPSE_FRACTION = 0.82;

const DOT_COLORS = {
  TOO_EARLY: '#6b7280',
  OK:        '#22c55e',
  WARNING:   '#eab308',
  CRITICAL:  '#ef4444',
} as const;

function dotState(tRatio: number): keyof typeof DOT_COLORS {
  if (tRatio < 0.3)  return 'TOO_EARLY';
  if (tRatio < 0.65) return 'OK';
  if (tRatio < 0.85) return 'WARNING';
  return 'CRITICAL';
}

function hillW(W0: number, tCrit: number, t: number): number {
  if (tCrit <= 0) return W0;
  return W0 / (1 + Math.pow(t / tCrit, HILL_EXPONENT));
}

export function MiniHillCurve({
  W0, tCrit, currentT, width = 300, height = 92,
}: {
  W0: number; tCrit: number; currentT: number; width?: number; height?: number;
}) {
  const padL = 30, padR = 8, padT = 6, padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Dominio: 0 → tCrit·1.6 (mostra la zona di collasso oltre t_crit)
  const tMax = Math.max(tCrit * 1.6, currentT * 1.1, 1);
  const x = (t: number) => padL + (t / tMax) * plotW;
  const y = (w: number) => padT + (1 - w / W0) * plotH;

  // Campiona la curva — split verde / rossa al punto di collasso
  const N = 60;
  const tSplit = tCrit * COLLAPSE_FRACTION;
  const greenPts: string[] = [];
  const redPts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * tMax;
    const w = hillW(W0, tCrit, t);
    const px = x(t).toFixed(1);
    const py = y(w).toFixed(1);
    if (t <= tSplit) {
      greenPts.push(`${px},${py}`);
      if (t + tMax / N > tSplit) redPts.push(`${px},${py}`); // giunzione continua
    } else {
      redPts.push(`${px},${py}`);
    }
  }

  const tRatio    = tCrit > 0 ? currentT / tCrit : 0;
  const state     = dotState(tRatio);
  const dotColor  = DOT_COLORS[state];
  const dotX      = x(Math.min(currentT, tMax));
  const dotY      = y(hillW(W0, tCrit, Math.min(currentT, tMax)));

  // Zona collasso (t ≥ tCrit) — sfondo rosso trasparente
  const collapseX = x(tCrit);

  const yLabels = [
    { w: W0,        label: `${Math.round(W0)}` },
    { w: W0 * 0.75, label: `${Math.round(W0 * 0.75)}` },
    { w: W0 * 0.5,  label: `${Math.round(W0 * 0.5)}` },
  ];

  // Label asse X in ore assolute — passo dinamico in base a tMax
  function computeXStep(tMax: number): number {
    if (tMax <= 24)  return 6;
    if (tMax <= 72)  return 12;
    if (tMax <= 150) return 24;
    if (tMax <= 300) return 48;
    return 72;
  }
  const xStep = computeXStep(tMax);
  const xLabels: Array<{ t: number; label: string; px: number }> = [];
  for (let t = 0; t <= tMax; t += xStep) {
    xLabels.push({ t, label: t === 0 ? '0' : `${t}h`, px: x(t) });
  }
  const labelY = padT + plotH + 14;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Zona collasso */}
      <rect x={collapseX} y={padT} width={Math.max(0, width - padR - collapseX)} height={plotH}
        fill="#ef4444" opacity={0.08} />

      {/* Asse Y — label W */}
      {yLabels.map(({ w, label }) => (
        <g key={label}>
          <line x1={padL} x2={width - padR} y1={y(w)} y2={y(w)} stroke="#1f2937" strokeWidth={0.5} />
          <text x={padL - 4} y={y(w) + 3} textAnchor="end" fontSize={8} fill="#4b5563"
            fontFamily="monospace">{label}</text>
        </g>
      ))}

      {/* Curva verde (struttura sana) */}
      {greenPts.length > 1 && (
        <polyline points={greenPts.join(' ')} fill="none" stroke="#22c55e" strokeWidth={2} />
      )}
      {/* Curva rossa (oltre il punto di collasso) */}
      {redPts.length > 1 && (
        <polyline points={redPts.join(' ')} fill="none" stroke="#ef4444" strokeWidth={2} />
      )}

      {/* Label asse X — passo dinamico */}
      {xLabels.map(({ t, label, px }) => (
        <text key={t} x={px} y={labelY} textAnchor="middle" fontSize={8} fill="#4b5563"
          fontFamily="monospace">{label}</text>
      ))}

      {/* Linea verticale t_crit */}
      <line x1={collapseX} x2={collapseX} y1={padT} y2={padT + plotH}
        stroke="#ef4444" strokeWidth={1} strokeDasharray="3 2" opacity={0.7} />
      {/* Label t_crit — stessa riga asse X, colore rosso per distinguersi */}
      <text x={collapseX} y={labelY} textAnchor="middle" fontSize={8} fill="#ef4444"
        fontFamily="monospace">{Math.round(tCrit)}h</text>

      {/* Dot stato corrente */}
      <circle cx={dotX} cy={dotY} r={5} fill={dotColor} stroke="#0a0a0a" strokeWidth={1.5} />
    </svg>
  );
}
