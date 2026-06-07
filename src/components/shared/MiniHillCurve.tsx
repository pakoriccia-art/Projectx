/**
 * PizzaMatrix — MiniHillCurve (Dashboard v4)
 * Curva di decadimento strutturale W(t) = W0 / (1 + (t/tCrit)^n) renderizzata in SVG.
 * Standalone, riusabile. Verde fino a t < tCrit·0.82, rossa oltre (zona collasso).
 * Dot di stato (grigio/verde/giallo/rosso) alla posizione corrente.
 *
 * v2.4.16 Bug #95: range X adattivo a sessionDurationH per sessioni brevi con t_crit lungo.
 * t_crit fuori range mostrato con "→Xh" invece di linea verticale.
 */
const HILL_EXPONENT = 5;
const COLLAPSE_FRACTION = 0.82;

// Palette stati allineata alla skin "Banco" (calda, coerente coi token app)
const DOT_COLORS = {
  TOO_EARLY: '#9a8a64',
  OK:        '#3ddc97',
  WARNING:   '#ffd166',
  CRITICAL:  '#ff7675',
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
  W0, tCrit, currentT, sessionDurationH, width = 300, height = 92,
}: {
  W0: number; tCrit: number; currentT: number;
  /** Durata totale pianificata [h] = targetBakeAt − mixStartAt. Limita il range X
   *  a qualcosa di significativo per la sessione. null → fallback a tCrit × 1.6. */
  sessionDurationH?: number | null;
  width?: number; height?: number;
}) {
  const padL = 30, padR = 8, padT = 6, padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Bug #95: range X adattivo.
  // tMaxFromCrit = tCrit × 1.6 (mostra la zona di collasso oltre t_crit)
  // tMaxFromSession = max(24, sessionDurationH × 1.5) (almeno 24h di contesto)
  // tMax = min(tMaxFromCrit, max(tMaxFromSession, tCrit × 0.5))
  // Con sessionDurationH=null: tMax = tCrit × 1.6 (comportamento precedente invariato)
  const tMaxFromCrit = Math.max(tCrit * 1.6, currentT * 1.1, 1);
  // #5: richiedi un valore finito (una data sessione malformata → NaN passerebbe `!= null`
  // e propagherebbe NaN in tMax → coordinate SVG NaN → grafico vuoto).
  const tMaxFromSession = (sessionDurationH != null && Number.isFinite(sessionDurationH))
    ? Math.max(24, sessionDurationH * 1.5)
    : null;
  const tMax = tMaxFromSession != null
    ? Math.min(tMaxFromCrit, Math.max(tMaxFromSession, tCrit * 0.5))
    : tMaxFromCrit;

  // t_crit mostrato solo se cade nel range visibile
  const showTCritMarker = tCrit <= tMax;

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

  // #8: x(tCrit) è sempre un numero; lo usiamo solo quando showTCritMarker è true,
  // così evitiamo il tipo number|null e le guardie ridondanti `collapseX != null`.
  const collapseX = x(tCrit);

  const yLabels = [
    { w: W0,        label: `${Math.round(W0)}` },
    { w: W0 * 0.75, label: `${Math.round(W0 * 0.75)}` },
    { w: W0 * 0.5,  label: `${Math.round(W0 * 0.5)}` },
  ];

  function computeXStep(tMaxVal: number): number {
    if (tMaxVal <= 12)  return 3;
    if (tMaxVal <= 24)  return 6;
    if (tMaxVal <= 48)  return 12;
    if (tMaxVal <= 96)  return 24;
    if (tMaxVal <= 200) return 48;
    return 72;
  }
  const xStep = computeXStep(tMax);
  const xLabels: Array<{ t: number; label: string; px: number }> = [];
  for (let t = 0; t <= tMax; t += xStep) {
    xLabels.push({ t, label: t === 0 ? '0' : `${t}h`, px: x(t) });
  }
  const labelY = padT + plotH + 14;

  // Area di riempimento sotto la curva (verde→rosso continuo) per dare profondità
  const baseY = padT + plotH;
  const areaD = (greenPts.length + redPts.length) > 1
    ? `M ${padL},${baseY} L ${[...greenPts, ...redPts].join(' L ')} L ${x(tMax).toFixed(1)},${baseY} Z`
    : '';
  const uid = `${Math.round(W0)}-${Math.round(tCrit)}`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`pm4w-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="0.62" stopColor="#9be8c0" />
          <stop offset="0.80" stopColor="#ffd166" />
          <stop offset="1" stopColor="#ff7675" />
        </linearGradient>
        <linearGradient id={`pm4a-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,140,50,0.14)" />
          <stop offset="1" stopColor="rgba(255,140,50,0)" />
        </linearGradient>
        <filter id={`pm4g-${uid}`} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Zona collasso — solo se t_crit nel range */}
      {showTCritMarker && (
        <rect x={collapseX} y={padT} width={Math.max(0, width - padR - collapseX)} height={plotH}
          fill="#ff7675" opacity={0.06} />
      )}

      {/* Asse Y — label W (hairline calda) */}
      {yLabels.map(({ w, label }) => (
        <g key={label}>
          <line x1={padL} x2={width - padR} y1={y(w)} y2={y(w)} stroke="#241a0e" strokeWidth={0.5} />
          <text x={padL - 4} y={y(w) + 3} textAnchor="end" fontSize={8} fill="#6a5836"
            fontFamily="'JetBrains Mono', monospace">{label}</text>
        </g>
      ))}

      {/* Riempimento area + curva con bagliore (gradiente verde→brace→rosso) */}
      {areaD && <path d={areaD} fill={`url(#pm4a-${uid})`} />}
      {greenPts.length > 1 && (
        <polyline points={greenPts.join(' ')} fill="none" stroke="#3ddc97" strokeWidth={2.2}
          strokeLinecap="round" filter={`url(#pm4g-${uid})`} />
      )}
      {redPts.length > 1 && (
        <polyline points={redPts.join(' ')} fill="none" stroke={`url(#pm4w-${uid})`} strokeWidth={2.2}
          strokeLinecap="round" filter={`url(#pm4g-${uid})`} />
      )}

      {/* Label asse X — passo dinamico */}
      {xLabels.map(({ t, label, px }) => (
        <text key={t} x={px} y={labelY} textAnchor="middle" fontSize={8} fill="#6a5836"
          fontFamily="'JetBrains Mono', monospace">{label}</text>
      ))}

      {/* t_crit nel range: linea verticale + label */}
      {showTCritMarker && (
        <>
          <line x1={collapseX} x2={collapseX} y1={padT} y2={padT + plotH}
            stroke="#ff7675" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
          <text x={collapseX} y={labelY} textAnchor="middle" fontSize={8} fill="#ff7675"
            fontFamily="'JetBrains Mono', monospace">{Math.round(tCrit)}h</text>
        </>
      )}

      {/* t_crit fuori range: freccia → con valore a destra */}
      {!showTCritMarker && (
        <text x={padL + plotW - 2} y={labelY} textAnchor="end" fontSize={8} fill="#ff7675"
          fontFamily="'JetBrains Mono', monospace">→{Math.round(tCrit)}h</text>
      )}

      {/* Dot stato corrente con alone pulsante */}
      <circle className="pm4-halo" cx={dotX} cy={dotY} r={9} fill="none" stroke={dotColor} strokeWidth={1} opacity={0.35} />
      <circle cx={dotX} cy={dotY} r={5} fill={dotColor} stroke="#0a0806" strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 6px ${dotColor})` }} />
    </svg>
  );
}
