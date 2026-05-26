/**
 * PizzaMatrix — Pianifica Fermentazione
 * Input: W farina, idratazione, agente, prefermento (opzionale), T ambiente, T frigo
 * Output: per ogni protocollo (ta/tc/tc_puntata/tc_appreto) il timing ottimale
 *         che porta la maturazione all'85% — calcolato analiticamente.
 *
 * Algoritmo:
 *   1. Inverte la curva Gompertz per trovare ADU_target a 85%
 *   2. Sottrae l'ADU iniziale (head-start da prefermenti) → ADU_needed
 *   3. Per ogni protocollo risolve analiticamente il timing:
 *      - TA:  totalH = ADU_needed / kRatio(tAmb) + staglioH
 *      - TC:  totalH = ADU_needed / kRatio(fridgeT) + staglioH
 *      - Mixed (tc_puntata / tc_appreto):
 *          coldH = (remainingH × kAmb − ADU_needed) / (kAmb − kFri)
 *          dove remainingH = targetTotalH − staglioH
 *   4. Valuta la viabilità in base al W della farina
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, SnapButtons, S } from '../ui';
import { kEffective, gompertz, AGENT_GOMPERTZ, normalizeFlourGroup } from '../../engine';

// ─── Tipi locali ─────────────────────────────────────────────────────────────

type Protocol = 'ta' | 'tc' | 'tc_puntata' | 'tc_appreto';
type Viability = 'ok' | 'risky' | 'no';

interface PrefConfig {
  type: 'poolish' | 'biga' | 'riporto';
  flourFraction: number;   // % su farina totale
  yeastPct:      number;   // % lievito nel prefermento (su farina prefermento); 0 per riporto
  tempC:         number;
  durationH:     number;
}

interface PlanResult {
  protocol:  Protocol;
  totalH:    number;
  puntataH?: number;
  staglioH:  number;
  apprettoH?: number;
  tcHours?:  number;
  viability: Viability;
  viabilityNote?: string;
  label:     string;
  desc:      string;
  stars:     number;       // 1-5
  matAtTarget?: number;   // maturazione% stimata all'orario target (se impostato)
  warmupH?:  number;      // ore riscaldo TA finale (solo tc_appreto)
}

// ─── Costanti modello crescita lievito ───────────────────────────────────────
const YEAST_DOUBLING_20C = 2.0;
const YEAST_EA_KJ        = 75;
const R_GAS              = 8.314e-3;
const T_20C_K            = 293.15;

// ─── Helper: inverte Gompertz per trovare ADU al target% ─────────────────────
// Il motore usa Zwietering 1990: A*exp(-exp((muMax*e/A)*(lambda-ADU)+1))
// Il coefficiente effettivo è muMax*e/A, NON muMax.
// Inversione corretta: ADU = lambda - (ln(-ln(target/A)) - 1) * A / (muMax * e)
// Clamp in (0,1) esclusivo per prevenire log(0) o log(negativo) se target ≥ asymptote.
function invertGompertz(target: number, muMax: number, lambda: number, asymptote = 100): number {
  const safeRatio = Math.max(1e-4, Math.min(target / asymptote, 1 - 1e-4));
  const x = Math.log(-Math.log(safeRatio));
  // Zwietering 1990: coefficiente = muMax * Math.E / asymptote
  return lambda - (x - 1) * asymptote / (muMax * Math.E);
}

// ─── Helper: stima effective dose incluso contributo prefermenti ──────────────
function computeEffectiveDoseAndAdu(
  pref: PrefConfig | null,
  mainDose: number,
  Ea: number, agentType: string,
): { effectiveDose: number; initialAdu: number } {
  if (!pref) return { effectiveDose: mainDose, initialAdu: 0 };

  const tempK   = pref.tempC + 273.15;
  const doubH   = YEAST_DOUBLING_20C * Math.exp(YEAST_EA_KJ / R_GAS * (1 / tempK - 1 / T_20C_K));
  const growth  = Math.min(40, Math.pow(2, pref.durationH / doubH));
  const yeastBoost = pref.yeastPct * (pref.flourFraction / 100) * growth;

  const kRef25 = (kEffective as Function)(25, Ea, agentType) as number;
  const kT     = (kEffective as Function)(pref.tempC, Ea, agentType) as number;
  const kRatio = kRef25 > 1e-12 ? kT / kRef25 : 0;
  const initialAdu = kRatio * pref.durationH * (pref.flourFraction / 100);

  return { effectiveDose: mainDose + yeastBoost, initialAdu };
}

// ─── Costanti modello termico (specchiate dall'engine, identiche a thermalTimeConstantSphere) ─
const TH_CP_WATER  = 4186;   // J/(kg·K)
const TH_CP_FLOUR  = 1840;   // J/(kg·K)
const TH_RHO_DOUGH = 1050;   // kg/m³
const TH_H_AIR     = 8;      // W/(m²·K) — convezione naturale aria in ambiente chiuso

/**
 * Ore per portare il core del panetto da fridgeTempC a 18°C (servizio) a tAmb.
 * Usa legge di Newton + τ sferica (thermalTimeConstantSphere del motore).
 * Ritorna 0 se tAmb ≤ 18°C (riscaldo impossibile) o fridgeTempC ≥ 18°C (già caldo).
 */
function computeWarmupH(panMassKg: number, hydrationPct: number, fridgeTempC: number, tAmb: number): number {
  const T_SERVICE = 18;
  if (tAmb <= T_SERVICE || fridgeTempC >= T_SERVICE) return 0;
  const h   = Math.max(0.01, hydrationPct / 100);
  const cp  = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);
  const V   = panMassKg / TH_RHO_DOUGH;
  const r   = Math.cbrt((3 * V) / (4 * Math.PI));
  const A   = 4 * Math.PI * r * r;
  const tau = (panMassKg * cp) / (TH_H_AIR * A);   // secondi
  const ratio = (fridgeTempC - tAmb) / (T_SERVICE - tAmb);
  if (ratio <= 0) return 0;
  return Math.max(0, (tau * Math.log(ratio)) / 3600);  // ore
}

// ─── Helper: viabilità W vs ore di fermentazione effettiva ───────────────────
// Le ore in frigo contano 20% rispetto alle ore a TA per il degrado proteolitico
function assessW(W: number, warmH: number, coldH: number): { viability: Viability; note?: string } {
  const effH = warmH + coldH * 0.2;
  const maxSafeH = W * 0.10;  // W 280 → max 28h effettive
  if (effH <= maxSafeH) return { viability: 'ok' };
  if (effH <= maxSafeH * 1.5) return { viability: 'risky', note: `W ${W} al limite (effH ${effH.toFixed(0)}h)` };
  return { viability: 'no', note: `W ${W} insufficiente (serve ≥ ${Math.round(effH / 0.10)})` };
}

// ─── Calcolo principale: timing ottimale per tutti e 4 i protocolli ──────────
function computeAllProtocols(params: {
  W: number;
  agentType: string; agentDosePct: number;
  aParams: { Ea: number; muMax: number; lambda: number };
  pref: PrefConfig | null;
  tAmb: number; fridgeT: number;
  staglioH: number;
  targetTotalH?: number;  // opzionale per i protocolli misti
  warmupH?: number;       // ore riscaldo TA finale per tc_appreto (Newton's law)
}): PlanResult[] {
  const { W, agentType, agentDosePct, aParams, pref, tAmb, fridgeT, staglioH } = params;

  // 1. Effective dose & initial ADU
  const doseRef = agentType === 'fresh_yeast' ? 0.3 : agentType === 'instant_dry_yeast' ? 0.1 : null;
  const { effectiveDose, initialAdu } = computeEffectiveDoseAndAdu(pref, agentDosePct, aParams.Ea, agentType);
  const doseFactor = doseRef != null ? effectiveDose / doseRef : 1.0;
  const muMax = aParams.muMax * Math.max(0.1, Math.min(2, doseFactor));

  // 2. ADU_target at 85%
  const aduTarget  = invertGompertz(85, muMax, aParams.lambda, 100);
  const aduNeeded  = Math.max(0.01, aduTarget - initialAdu);

  // 3. kRatio per TA e frigo
  const kRef = (kEffective as Function)(25, aParams.Ea, agentType) as number;
  const kAmb = (kEffective as Function)(tAmb,    aParams.Ea, agentType) as number;
  const kFri = (kEffective as Function)(fridgeT, aParams.Ea, agentType) as number;
  const rAmb = kRef > 1e-12 ? kAmb / kRef : 1;
  const rFri = kRef > 1e-12 ? kFri / kRef : 1;

  const results: PlanResult[] = [];

  // ── TA ──────────────────────────────────────────────────────────────────────
  {
    const warmH    = rAmb > 0 ? aduNeeded / rAmb : Infinity;
    const totalH   = warmH + staglioH;
    const puntataH = warmH * 0.65;
    const apprettoH = warmH * 0.35;
    const { viability, note } = assessW(W, warmH, 0);
    // matAtTarget: quanto sarà la maturazione all'orario target scelto?
    let matAtTargetTA: number | undefined;
    if (params.targetTotalH !== undefined && isFinite(warmH)) {
      const aduAtT = initialAdu + rAmb * Math.max(0, params.targetTotalH - staglioH);
      const raw = (gompertz as Function)(aduAtT, muMax, aParams.lambda, 100) as number;
      matAtTargetTA = isNaN(raw) ? undefined : Math.min(100, Math.max(0, raw));
    }
    results.push({
      protocol: 'ta', totalH, puntataH, staglioH, apprettoH,
      viability, viabilityNote: note,
      matAtTarget: matAtTargetTA,
      label: 'Tutto TA',
      desc:  `Puntata ${puntataH.toFixed(1)}h + Staglio ${staglioH.toFixed(1)}h + Appretto ${apprettoH.toFixed(1)}h`,
      stars: W >= 280 ? 2 : 3,
    });
  }

  // ── TC (tutto in frigo) ──────────────────────────────────────────────────────
  {
    const coldH   = rFri > 0 ? aduNeeded / rFri : Infinity;
    const totalH  = coldH + staglioH;
    const { viability, note } = assessW(W, 0, coldH);
    // matAtTarget: quanto sarà la maturazione all'orario target scelto?
    let matAtTargetTC: number | undefined;
    if (params.targetTotalH !== undefined && isFinite(coldH)) {
      const aduAtT = initialAdu + rFri * Math.max(0, params.targetTotalH - staglioH);
      const raw = (gompertz as Function)(aduAtT, muMax, aParams.lambda, 100) as number;
      matAtTargetTC = isNaN(raw) ? undefined : Math.min(100, Math.max(0, raw));
    }
    results.push({
      protocol: 'tc', totalH, tcHours: coldH, staglioH,
      viability, viabilityNote: note,
      matAtTarget: matAtTargetTC,
      label: 'TC totale',
      desc:  `Freddo ${coldH.toFixed(1)}h + Staglio ${staglioH.toFixed(1)}h`,
      stars: coldH > 8 ? (viability === 'ok' ? 4 : 2) : 2,
    });
  }

  // ── TC Puntata e TC Appreto — richiedono un targetTotalH ────────────────────
  // Se non fornito, usa la media tra TA e TC
  const taTotal = rAmb > 0 ? aduNeeded / rAmb + staglioH : 24;
  const tcTotal = rFri > 0 ? aduNeeded / rFri + staglioH : 72;
  const targetTotalH = params.targetTotalH ?? (taTotal + tcTotal) / 2;

  // Formula analitica: coldH × kFri + warmH × kAmb = ADU_needed, coldH + warmH = remainingH
  // → coldH = (remainingH × rAmb − aduNeeded) / (rAmb − rFri)
  const denominator = rAmb - rFri;

  // ── TC Puntata: nessuna fase di riscaldo — usa il tempo pieno per fermentazione ─
  const remainingH_puntata = Math.max(1, targetTotalH - staglioH);
  const coldH_mixed = denominator > 1e-12
    ? (remainingH_puntata * rAmb - aduNeeded) / denominator
    : null;
  const warmH_mixed = coldH_mixed !== null ? remainingH_puntata - coldH_mixed : null;

  // ── TC Appreto: il warmupH è riservato al riscaldo finale → fermentazione sul tempo rimanente ─
  const wH = params.warmupH ?? 0;
  const remainingH_appreto = Math.max(1, targetTotalH - staglioH - wH);
  const coldH_appreto = denominator > 1e-12
    ? (remainingH_appreto * rAmb - aduNeeded) / denominator
    : null;
  const warmH_appreto = coldH_appreto !== null ? remainingH_appreto - coldH_appreto : null;

  // ── TC Puntata ───────────────────────────────────────────────────────────────
  if (coldH_mixed !== null && warmH_mixed !== null && coldH_mixed > 0.5 && warmH_mixed > 0.5) {
    const { viability, note } = assessW(W, warmH_mixed, coldH_mixed);
    results.push({
      protocol: 'tc_puntata', totalH: targetTotalH,
      tcHours: coldH_mixed, staglioH, apprettoH: warmH_mixed,
      viability, viabilityNote: note,
      label: 'TC Puntata',
      desc: `Puntata fredda ${coldH_mixed.toFixed(1)}h + Staglio ${staglioH.toFixed(1)}h + Appretto TA ${warmH_mixed.toFixed(1)}h`,
      stars: viability === 'ok' ? 4 : 2,
    });
  }

  // ── TC Appreto ───────────────────────────────────────────────────────────────
  if (coldH_appreto !== null && warmH_appreto !== null && coldH_appreto > 0.5 && warmH_appreto > 0.5) {
    const { viability, note } = assessW(W, warmH_appreto, coldH_appreto);
    const warmupSuffix = wH > 0.05 ? ` + Riscaldo TA ${wH.toFixed(1)}h` : '';
    results.push({
      protocol: 'tc_appreto', totalH: targetTotalH,
      puntataH: warmH_appreto, staglioH, tcHours: coldH_appreto,
      warmupH: wH > 0.05 ? wH : undefined,
      viability, viabilityNote: note,
      label: 'TC Appreto',
      desc: `Puntata TA ${warmH_appreto.toFixed(1)}h + Staglio ${staglioH.toFixed(1)}h + Appretto freddo ${coldH_appreto.toFixed(1)}h${warmupSuffix}`,
      stars: viability === 'ok' ? 3 : 2,
    });
  }

  // Ordina: ok prima, poi risky, poi no; dentro ogni gruppo per stelle desc
  return results.sort((a, b) => {
    const order: Record<Viability, number> = { ok: 0, risky: 1, no: 2 };
    const vDiff = order[a.viability] - order[b.viability];
    if (vDiff !== 0) return vDiff;
    return b.stars - a.stars;
  });
}

// ─── Mini Gompertz preview inline ─────────────────────────────────────────────
function MiniCurve({ result, aParams, agentType, tAmb, fridgeT, initialAdu, muMax }: {
  result: PlanResult; aParams: { Ea: number; muMax: number; lambda: number };
  agentType: string; tAmb: number; fridgeT: number; initialAdu: number; muMax: number;
}) {
  const points = useMemo(() => {
    const maxH  = result.totalH * 1.5;
    const steps = 40;
    const kRef  = (kEffective as Function)(25, aParams.Ea, agentType) as number;
    const pts: { h: number; pct: number }[] = [];
    let cumAdu = initialAdu;
    let h = 0;
    const stepH = maxH / steps;

    // Segmenti per il protocollo
    const proto = result.protocol;
    const s = result.staglioH;
    const segs: { durationH: number; tempC: number }[] =
      proto === 'ta' ? [
        { durationH: result.puntataH ?? 0, tempC: tAmb },
        { durationH: s, tempC: tAmb },
        { durationH: result.apprettoH ?? 0, tempC: tAmb },
      ]
      : proto === 'tc' ? [
        { durationH: result.tcHours ?? 0, tempC: fridgeT },
        { durationH: s, tempC: tAmb },
      ]
      : proto === 'tc_puntata' ? [
        { durationH: result.tcHours ?? 0, tempC: fridgeT },
        { durationH: s, tempC: tAmb },
        { durationH: result.apprettoH ?? 0, tempC: tAmb },
      ]
      : [
        { durationH: result.puntataH ?? 0, tempC: tAmb },
        { durationH: s, tempC: tAmb },
        { durationH: result.tcHours ?? 0, tempC: fridgeT },
        ...(result.warmupH ? [{ durationH: result.warmupH, tempC: tAmb }] : []),
      ];

    for (const seg of segs) {
      const kT = (kEffective as Function)(seg.tempC, aParams.Ea, agentType) as number;
      const ratio = kRef > 1e-12 ? kT / kRef : 1;
      const n = Math.max(1, Math.round(seg.durationH / stepH));
      const sh = seg.durationH / n;
      for (let i = 0; i < n; i++) {
        cumAdu += sh * ratio;
        h += sh;
        const raw = (gompertz as Function)(cumAdu, muMax, aParams.lambda, 100) as number;
        pts.push({ h, pct: isNaN(raw) ? 0 : raw });
      }
    }
    // Coda a tAmb
    while (h < maxH) {
      const kT = (kEffective as Function)(tAmb, aParams.Ea, agentType) as number;
      const ratio = kRef > 1e-12 ? kT / kRef : 1;
      cumAdu += stepH * ratio;
      h += stepH;
      const raw = (gompertz as Function)(cumAdu, muMax, aParams.lambda, 100) as number;
      pts.push({ h, pct: isNaN(raw) ? 0 : raw });
    }
    return pts;
  }, [result, aParams, agentType, tAmb, fridgeT, initialAdu, muMax]);

  // SVG mini sparkline 120x40
  const W_SVG = 120, H_SVG = 40;
  const maxH = result.totalH * 1.5;
  const pathD = points.map((p, i) => {
    const x = (p.h / maxH) * W_SVG;
    const y = H_SVG - (p.pct / 100) * H_SVG;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  // Linea 85%
  const y85 = H_SVG - 0.85 * H_SVG;
  // Linea fine protocollo
  const xEnd = (result.totalH / maxH) * W_SVG;

  return (
    <svg width={W_SVG} height={H_SVG} style={{ display: 'block', flexShrink: 0 }}>
      {/* 85% line */}
      <line x1={0} y1={y85} x2={W_SVG} y2={y85}
        stroke="rgba(0,184,148,0.4)" strokeWidth={1} strokeDasharray="3 2" />
      {/* End of protocol */}
      <line x1={xEnd} y1={0} x2={xEnd} y2={H_SVG}
        stroke="rgba(255,140,50,0.5)" strokeWidth={1} strokeDasharray="3 2" />
      {/* Curve */}
      <path d={pathD} fill="none" stroke="var(--accent-brand)" strokeWidth={1.5} />
    </svg>
  );
}

// ─── Card singolo protocollo ──────────────────────────────────────────────────
function ProtocolCard({ result, aParams, agentType, tAmb, fridgeT, initialAdu, muMax, onUse }: {
  result: PlanResult; aParams: { Ea: number; muMax: number; lambda: number };
  agentType: string; tAmb: number; fridgeT: number; initialAdu: number; muMax: number;
  onUse: () => void;
}) {
  const viabilityStyle: Record<Viability, { bg: string; color: string }> = {
    ok:    { bg: 'rgba(0,184,148,0.1)',   color: 'var(--state-optimal-hi)' },
    risky: { bg: 'rgba(255,140,50,0.1)',  color: 'var(--accent-warning)' },
    no:    { bg: 'rgba(214,48,49,0.08)',  color: 'var(--state-critical)' },
  };
  const vs = viabilityStyle[result.viability];
  const stars = '★'.repeat(result.stars) + '☆'.repeat(Math.max(0, 5 - result.stars));

  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${result.viability === 'ok' ? 'rgba(255,140,50,0.2)' : 'rgba(255,255,255,0.08)'}`,
      background: result.viability === 'ok' ? 'var(--bg-elevated)' : 'var(--bg-base)',
      padding: '14px 16px', opacity: result.viability === 'no' ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            {result.label}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {stars} · {result.totalH.toFixed(1)}h totali
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MiniCurve result={result} aParams={aParams} agentType={agentType}
            tAmb={tAmb} fridgeT={fridgeT} initialAdu={initialAdu} muMax={muMax} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 700,
            background: vs.bg, color: vs.color,
            borderRadius: 4, padding: '2px 7px',
          }}>
            {result.viability === 'ok' ? 'OK' : result.viability === 'risky' ? '⚠ RISCHIO W' : '✗ W basso'}
          </span>
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
        {result.desc}
      </div>

      {result.warmupH !== undefined && result.warmupH > 0.05 && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginBottom: 6,
          padding: '4px 8px', background: 'rgba(253,203,110,0.1)',
          borderRadius: 4, border: '1px solid rgba(253,203,110,0.2)',
          color: 'var(--state-approaching)',
        }}>
          🌡 Riscaldo TA finale: <strong>{result.warmupH.toFixed(1)}h</strong> (frigo → 18°C)
        </div>
      )}

      {result.matAtTarget !== undefined && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Al tuo target: </span>
          <strong style={{
            color: result.matAtTarget > 95 ? 'var(--state-critical)'
                 : result.matAtTarget > 75 ? 'var(--state-optimal-hi)'
                 : 'var(--state-cold)',
          }}>
            {result.matAtTarget.toFixed(0)}%
          </strong>
          {result.matAtTarget > 95 && <span style={{ color: 'var(--state-critical)', marginLeft: 6 }}>· sovramaturato</span>}
          {result.matAtTarget < 60 && <span style={{ color: 'var(--state-cold)', marginLeft: 6 }}>· sottomaturato</span>}
        </div>
      )}

      {result.viabilityNote && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: vs.color, marginBottom: 8, opacity: 0.85 }}>
          {result.viabilityNote}
        </div>
      )}

      {result.viability !== 'no' && (
        <button onClick={onUse} style={{
          background: 'var(--accent-brand)', color: '#0a0806',
          border: 'none', borderRadius: 'var(--radius-sm)',
          padding: '7px 14px', fontFamily: 'var(--font-mono)',
          fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
        }}>
          Usa questo schema →
        </button>
      )}
    </div>
  );
}

// ─── Slider con label inline ──────────────────────────────────────────────────
function PlannerSlider({ label, value, onChange, min, max, step, unit, color }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string; color?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={S.label}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: color ?? 'var(--text-secondary)' }}>
          {value}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color ?? 'var(--accent-brand)' }} />
    </div>
  );
}

// ─── Vista principale ─────────────────────────────────────────────────────────
export function FermentationPlannerView() {
  const { dispatch } = useApp();

  // Parametri farina + agente
  const [W,           setW]           = useState(280);
  const [agentType,   setAgentType]   = useState<'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat'>('fresh_yeast');
  const [dosePct,     setDosePct]     = useState(0.3);
  const [tAmb,        setTAmb]        = useState(22);
  const [fridgeT,     setFridgeT]     = useState(4);
  const [staglioH,    setStaglioH]    = useState(0.5);

  // Parametri impasto (per il wizard)
  const [style,       setStyle]       = useState<'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle'>('napoletana');
  const [totalFlourG, setTotalFlourG] = useState(500);
  const [hydration,   setHydration]   = useState(65);
  const [numPanetti,  setNumPanetti]  = useState(4);

  // Target cottura
  const [targetDate,  setTargetDate]  = useState('');
  const [targetTime,  setTargetTime]  = useState('12:00');

  // Ore fino alla cottura (per passare targetTotalH a computeAllProtocols)
  const hoursUntilBake = useMemo(() => {
    if (!targetDate) return undefined;
    const bakeMs = new Date(`${targetDate}T${targetTime}`).getTime();
    const diffMs = bakeMs - Date.now();
    return diffMs > 0 ? diffMs / 3_600_000 : undefined;
  }, [targetDate, targetTime]);

  // Prefermento opzionale
  const [hasPref,     setHasPref]     = useState(false);
  const [prefType,    setPrefType]    = useState<'poolish' | 'biga' | 'riporto'>('biga');
  const [prefFrac,    setPrefFrac]    = useState(40);
  const [prefYeast,   setPrefYeast]   = useState(0.10);
  const [prefTemp,    setPrefTemp]    = useState(16);
  const [prefDur,     setPrefDur]     = useState(16);

  const pref: PrefConfig | null = hasPref
    ? { type: prefType, flourFraction: prefFrac, yeastPct: prefType === 'riporto' ? 0 : prefYeast, tempC: prefTemp, durationH: prefDur }
    : null;

  // Parametri agente Gompertz
  const agent   = AGENT_GOMPERTZ as any;
  const aParams = agent[agentType] as { Ea: number; muMax: number; lambda: number };

  // Dose di riferimento per scaling muMax
  const doseRef = agentType === 'fresh_yeast' ? 0.3 : agentType === 'instant_dry_yeast' ? 0.1 : null;
  const { effectiveDose, initialAdu } = useMemo(
    () => computeEffectiveDoseAndAdu(pref, dosePct, aParams.Ea, agentType),
    [pref, dosePct, aParams.Ea, agentType],
  );
  const muMax = aParams.muMax * Math.max(0.1, Math.min(2, doseRef != null ? effectiveDose / doseRef : 1.0));

  // Massa panetto — usata per il calcolo del riscaldo tc_appreto
  const panMassKg = (totalFlourG * (1 + hydration / 100 + 0.028)) / 1000 / Math.max(1, numPanetti);
  const warmupHPlanner = computeWarmupH(panMassKg, hydration, fridgeT, tAmb);

  // Calcolo ottimale per tutti i protocolli (targetTotalH dalle ore fino a cottura)
  const results = useMemo(() => {
    try {
      return computeAllProtocols({ W, agentType, agentDosePct: dosePct, aParams, pref, tAmb, fridgeT, staglioH, targetTotalH: hoursUntilBake, warmupH: warmupHPlanner });
    } catch { return []; }
  }, [W, agentType, dosePct, aParams, pref, tAmb, fridgeT, staglioH, hoursUntilBake, warmupHPlanner]);

  // Lancia wizard con i parametri del protocollo scelto → direttamente al riepilogo (step 8)
  const useResult = (r: PlanResult) => {
    // FlourGroup sintetico dal W selezionato nel planner
    const flourArr = [{
      name: 'Farina', brand: '', W, pl: 0.55, protein: 12.5,
      ash: 0.55, amylaseActivity: 0.5, percentage: 100,
    }];
    const mainFlourGroup = (normalizeFlourGroup as Function)(flourArr) as any;

    // Target cottura (opzionale)
    let targetBakeAt: Date | undefined;
    if (targetDate) {
      targetBakeAt = new Date(`${targetDate}T${targetTime}`);
    }

    // Protocollo wizard (direct vs single_pref)
    const protocol = hasPref ? ('single_pref' as const) : ('direct' as const);

    // Prefermento per wizard (se presente)
    const prefHydration = prefType === 'biga' ? 48 : prefType === 'riporto' ? 65 : 100;
    const prefermenti = hasPref ? [{
      id: `planner_${Date.now()}`,
      type: prefType,
      flourGroup: mainFlourGroup,
      flourFraction: prefFrac,
      hydration: prefHydration,
      tempC: prefTemp,
      durationH: prefDur,
      yeastPct: prefType === 'riporto' ? undefined : prefYeast,
    }] : [];

    // Transizione atomica: reset + patch + step 8 in un solo dispatch (evita flash Step1)
    dispatch({ type: 'WIZARD_RESET_WITH_PATCH', step: 8, patch: {
      style,
      protocol,
      mainFlourGroup,
      prefermenti,
      agentType,
      agentDosePct:     dosePct,
      apprettoProtocol: r.protocol,
      puntataH:         r.puntataH  ?? 8,
      staglioH:         r.staglioH,
      apprettoH:        r.protocol === 'tc_appreto' ? (r.warmupH ?? 0) : (r.apprettoH ?? 4),
      tcHours:          r.tcHours,
      fridgeTempC:      fridgeT,
      targetBakeAt,
      totalFlourGrams:  totalFlourG,
      hydration,
      numPanetti,
    }});
    dispatch({ type: 'NAV', view: 'wizard' });
  };

  // Dose range dipende dal tipo di agente
  const doseRange = agentType === 'sourdough_wheat'
    ? { min: 5, max: 40, step: 0.5, unit: '%' }
    : agentType === 'instant_dry_yeast'
    ? { min: 0.01, max: 0.5, step: 0.01, unit: '%' }
    : { min: 0.05, max: 2, step: 0.05, unit: '%' };

  return (
    <div style={{
      minHeight: '100dvh',
      padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 20,
      paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          style={{ background: 'none', border: 'none', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer' }}
        >←</button>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Pianifica Fermentazione
          </h2>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Calcolo analitico ottimale · Arrhenius × Gompertz
          </div>
        </div>
      </div>

      {/* ── Impasto ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SnapButtons
            label="Stile pizza"
            options={[
              { value: 'napoletana',    label: 'Napoletana', desc: 'Alta idratazione, cornicione' },
              { value: 'contemporanea', label: 'Contemp.',   desc: 'Leggera, alveolatura aperta' },
              { value: 'teglia',        label: 'Teglia',     desc: 'Alta idratazione, soffice' },
              { value: 'pala',          label: 'Pala',       desc: 'Idratazione alta, croccante' },
              { value: 'nystyle',       label: 'NY Style',   desc: 'Sottile, grande' },
            ]}
            value={style}
            onChange={v => setStyle(v as typeof style)}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <PlannerSlider label="Farina totale" value={totalFlourG} onChange={setTotalFlourG}
              min={100} max={3000} step={50} unit="g" color="var(--text-primary)" />
            <PlannerSlider label="Panetti" value={numPanetti} onChange={setNumPanetti}
              min={1} max={20} step={1} color="var(--text-muted)" />
          </div>
          <PlannerSlider label="Idratazione" value={hydration} onChange={setHydration}
            min={55} max={90} step={1} unit="%" color="var(--accent-info)" />
          {/* Preview peso panetto */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Peso panetto stimato:{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              {Math.round(totalFlourG * (1 + hydration / 100 + 0.028) / numPanetti)}g
            </strong>
            {' '}(farina + acqua + 2.8% sale)
          </div>
        </div>
      </Card>

      {/* ── Farina + Agente ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PlannerSlider label="Forza farina (W)" value={W} onChange={setW}
            min={100} max={500} step={5} unit="W" color="var(--text-primary)" />

          <SnapButtons
            label="Agente lievitante"
            options={[
              { value: 'fresh_yeast',       label: 'LBF',  desc: 'Lievito di birra fresco' },
              { value: 'instant_dry_yeast', label: 'IDY',  desc: 'Lievito secco istantaneo' },
              { value: 'sourdough_wheat',   label: 'LM',   desc: 'Lievito madre (pasta acida)' },
            ]}
            value={agentType}
            onChange={v => {
              setAgentType(v as any);
              // Reset dose al default del tipo
              setDosePct(v === 'fresh_yeast' ? 0.3 : v === 'instant_dry_yeast' ? 0.1 : 15);
            }}
          />

          <PlannerSlider label={`Dose lievito (% su farina)`}
            value={dosePct} onChange={setDosePct}
            {...doseRange} color="var(--accent-brand)" />
        </div>
      </Card>

      {/* ── Temperature + Staglio ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PlannerSlider label="Temperatura ambiente" value={tAmb} onChange={setTAmb}
            min={10} max={38} step={0.5} unit="°C" />
          <PlannerSlider label="Temperatura frigo (TC)" value={fridgeT} onChange={setFridgeT}
            min={1} max={8} step={0.5} unit="°C" color="var(--state-cold)" />
          <PlannerSlider label="Staglio" value={staglioH} onChange={setStaglioH}
            min={0.1} max={2} step={0.1} unit="h" color="var(--text-muted)" />
        </div>
      </Card>

      {/* ── Target cottura ── */}
      <Card>
        <div style={{ ...S.label, marginBottom: 12 }}>Target cottura (opzionale)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem', outline: 'none', width: '100%',
            }}
          />
          <input
            type="time"
            value={targetTime}
            onChange={e => setTargetTime(e.target.value)}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem', outline: 'none', width: 95,
            }}
          />
        </div>
        {targetDate && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginTop: 8 }}>
            <span style={{ color: 'var(--accent-brand)' }}>
              Cottura: {new Date(`${targetDate}T${targetTime}`).toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            {hoursUntilBake !== undefined && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
                → tra {hoursUntilBake.toFixed(1)}h
              </span>
            )}
            {hoursUntilBake === undefined && (
              <span style={{ color: 'var(--state-critical)', marginLeft: 10 }}>· data nel passato</span>
            )}
          </div>
        )}
        {hoursUntilBake !== undefined && hoursUntilBake < staglioH + 2 && (
          <div style={{ color: 'var(--state-critical)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginTop: 8 }}>
            ⚠ Meno di {(staglioH + 2).toFixed(0)}h al target — protocolli misti non disponibili
          </div>
        )}
      </Card>

      {/* ── Prefermento ── */}
      <Card>
        <SnapButtons
          label="Prefermento"
          options={[
            { value: 'none',    label: 'Nessuno',  desc: 'Impasto diretto' },
            { value: 'poolish', label: 'Poolish',   desc: 'Idr. 100%' },
            { value: 'biga',    label: 'Biga',      desc: 'Idr. 44–50%' },
            { value: 'riporto', label: 'Riporto',   desc: 'Impasto vecchio' },
          ]}
          value={hasPref ? prefType : 'none'}
          onChange={v => {
            if (v === 'none') { setHasPref(false); }
            else {
              setHasPref(true);
              setPrefType(v as 'poolish' | 'biga' | 'riporto');
              // Default riporto: 20% farina, 24h, 20°C
              if (v === 'riporto') { setPrefFrac(20); setPrefDur(24); setPrefTemp(20); setPrefYeast(0); }
            }
          }}
        />

        {hasPref && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PlannerSlider
              label={prefType === 'riporto' ? '% impasto di riporto' : '% farina nel prefermento'}
              value={prefFrac} onChange={setPrefFrac}
              min={prefType === 'riporto' ? 5 : 10} max={prefType === 'riporto' ? 40 : 70} step={5}
              unit="%" color="var(--pref-biga)" />
            {prefType !== 'riporto' && (
              <PlannerSlider label="Lievito nel prefermento" value={prefYeast} onChange={setPrefYeast}
                min={0.01} max={prefType === 'biga' ? 1.0 : 0.5} step={0.01} unit="%" color="var(--accent-brand)" />
            )}
            {prefType === 'riporto' && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                ℹ Il riporto porta lieviti vivi dal precedente impasto — nessun lievito aggiuntivo nel prefermento
              </div>
            )}
            <PlannerSlider label="Temperatura prefermento" value={prefTemp} onChange={setPrefTemp}
              min={4} max={26} step={0.5} unit="°C" />
            <PlannerSlider label="Durata prefermento" value={prefDur} onChange={setPrefDur}
              min={1} max={72} step={1} unit="h" color="var(--pref-biga)" />

            {/* Info contributo yeast */}
            {prefType !== 'riporto' && (
              <Card elevated style={{ padding: '10px 14px', background: 'rgba(253,203,110,0.06)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-warning)' }}>
                  Dose efficace totale: {effectiveDose.toFixed(3)}%
                  {effectiveDose > (doseRef ?? 0.3) * 2 ? ' · lievito molto attivo 🚀' : ''}
                </span>
              </Card>
            )}
          </div>
        )}
      </Card>

      {/* ── Risultati ── */}
      <div>
        <div style={{ ...S.label, marginBottom: 12 }}>
          Protocolli ottimali a {tAmb}°C TA / {fridgeT}°C TC
        </div>
        {results.length === 0 ? (
          <Card style={{ textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            Inserisci i parametri sopra per vedere i suggerimenti
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {results.map(r => (
              <ProtocolCard
                key={r.protocol}
                result={r}
                aParams={aParams}
                agentType={agentType}
                tAmb={tAmb}
                fridgeT={fridgeT}
                initialAdu={initialAdu}
                muMax={muMax}
                onUse={() => useResult(r)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <Metric label="kRatio (TA / TC)" value={`${((kEffective as Function)(tAmb, aParams.Ea, agentType) as number / (kEffective as Function)(25, aParams.Ea, agentType) as number).toFixed(3)} / ${((kEffective as Function)(fridgeT, aParams.Ea, agentType) as number / (kEffective as Function)(25, aParams.Ea, agentType) as number).toFixed(4)}`} />
    </div>
  );
}
