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
import { useState, useMemo, useEffect, useRef, useId } from 'react';
import { useApp } from '../../context/AppContext';
import { Card, Metric, SnapButtons, S, Badge, useReducedMotion, pulseElement } from '../ui';
import {
  kEffective, gompertz, AGENT_GOMPERTZ, normalizeFlourGroup,
  computeWaterTempDDT, KNEADING_METHODS_FRICTION, type KneadingMethod,
  fArrhenius, ENZYMATIC_CLOCK_PARAMS, findAduAt, getStyleProfile,
  computeFrictionRise, CONTAINER_THERMAL_PRESETS,
} from '../../engine';
import { scaleMuMaxByDose, doseFactorSaturated } from '../../engine';
import { SERVICE_WINDOW_DEFAULTS } from '../../engine/serviceWindowSolver';
import { computeNowAnchoredAlarms, type NowAnchoredAlarmResult } from '../../engine/plannerAlarmEngine';
import { WaterTempResultCard } from './WaterTempView';
import { PrefermentCreditCard } from '../wizard/PrefermentCreditCard';
import { FLOUR_DATABASE, getFlourBrands, getFloursByBrand } from '../../data/flourDatabase';
import { ddtForStyle } from '../../data/styleConstraints';
import { DOUGH_LIMITS } from '../../constants/limits';

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

// ─── Validazione input planner ───────────────────────────────────────────────
function validatePlannerInputs(totalFlourGrams: number, numPanetti: number, hydration: number): string[] {
  const errors: string[] = [];
  if (totalFlourGrams < 200 || totalFlourGrams > DOUGH_LIMITS.MAX_FARINA_G) {
    errors.push(`Farina totale: ${totalFlourGrams}g fuori range (200–${DOUGH_LIMITS.MAX_FARINA_G}g)`);
  }
  if (numPanetti < DOUGH_LIMITS.MIN_PANETTI || numPanetti > DOUGH_LIMITS.MAX_PANETTI) {
    errors.push(`Panetti: ${numPanetti} fuori range (${DOUGH_LIMITS.MIN_PANETTI}–${DOUGH_LIMITS.MAX_PANETTI})`);
  }
  if (hydration < DOUGH_LIMITS.MIN_HYDRATION || hydration > DOUGH_LIMITS.MAX_HYDRATION) {
    errors.push(`Idratazione fuori range (${DOUGH_LIMITS.MIN_HYDRATION}–${DOUGH_LIMITS.MAX_HYDRATION}%)`);
  }
  return errors;
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
function computeWarmupH(panMassKg: number, hydrationPct: number, fridgeTempC: number, tAmb: number, tauMultiplier = 1.0): number {
  const T_SERVICE = 18;
  if (tAmb <= T_SERVICE || fridgeTempC >= T_SERVICE) return 0;
  const h   = Math.max(0.01, hydrationPct / 100);
  const cp  = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);
  const V   = panMassKg / TH_RHO_DOUGH;
  const r   = Math.cbrt((3 * V) / (4 * Math.PI));
  const A   = 4 * Math.PI * r * r;
  // τ con la resistenza del contenitore, come wizard e tick della dashboard
  const tau = (panMassKg * cp) / (TH_H_AIR * A) * tauMultiplier;   // secondi
  const ratio = (fridgeTempC - tAmb) / (T_SERVICE - tAmb);
  if (ratio <= 0) return 0;
  return Math.max(0, (tau * Math.log(ratio)) / 3600);  // ore
}

/**
 * ADU accumulato durante la risalita termica (stemperamento) da fridgeTempC verso tAmb.
 * Integrazione numerica di Riemann (N=20 passi) su T(t) = tAmb + (fridgeT−tAmb)·exp(−t/τ).
 * τ sferica = thermalTimeConstantSphere (costanti identiche a computeWarmupH).
 *
 * Garantisce l'allineamento esatto target bake ↔ sweet spot (85%):
 *   ADU_totale @ targetTotalH = (aduNeeded − ADU_ramp) + ADU_ramp = aduNeeded → 85% ✓
 *
 * Ritorna 0 se wH ≤ 0.
 */
function computeRampAdu(
  panMassKg: number, hydrationPct: number,
  fridgeTempC: number, tAmb: number, wH: number,
  Ea: number, agentType: string, kRef: number,
  tauMultiplier = 1.0,
): number {
  if (wH <= 0 || kRef <= 1e-12) return 0;
  const h    = Math.max(0.01, hydrationPct / 100);
  const cp   = TH_CP_WATER * h + TH_CP_FLOUR * (1 - h);
  const V    = panMassKg / TH_RHO_DOUGH;
  const r    = Math.cbrt((3 * V) / (4 * Math.PI));
  const A    = 4 * Math.PI * r * r;
  const tau  = (panMassKg * cp) / (TH_H_AIR * A) * tauMultiplier;   // τ [s]
  const N    = 20;
  const dt_h = wH / N;
  const dt_s = dt_h * 3600;
  let adu    = 0;
  for (let i = 0; i < N; i++) {
    const t_mid = (i + 0.5) * dt_s;
    const T     = tAmb + (fridgeTempC - tAmb) * Math.exp(-t_mid / tau);
    const k     = (kEffective as Function)(T, Ea, agentType) as number;
    adu        += (k / kRef) * dt_h;
  }
  return adu;
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
  rampAdu?: number;       // ADU accumulato durante lo stemperamento (integrazione numerica)
}): PlanResult[] {
  const { W, agentType, agentDosePct, aParams, pref, tAmb, fridgeT, staglioH } = params;

  // 1. Effective dose & initial ADU
  const doseRef = agentType === 'fresh_yeast' ? 0.3 : agentType === 'instant_dry_yeast' ? 0.1 : null;
  const { effectiveDose, initialAdu } = computeEffectiveDoseAndAdu(pref, agentDosePct, aParams.Ea, agentType);
  // issue #8 — sorgente unica nell'engine (era clamp [0.1, 2] duplicato)
  const muMax = (scaleMuMaxByDose as Function)(aParams.muMax, effectiveDose, doseRef) as number;

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
      desc:  `Puntata ${fmtHours(puntataH)} · staglio ${fmtHours(staglioH)} · appretto ${fmtHours(apprettoH)}`,
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
      desc:  `In frigo ${fmtHours(coldH)} · staglio ${fmtHours(staglioH)}`,
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

  // ── TC Appreto: il warmupH è riservato allo stemperamento finale ────────────
  // L'ADU accumulato durante la risalita termica (rampAdu) viene sottratto da
  // aduNeeded prima di risolvere il sistema freddo/caldo, così il target bake
  // coincide esattamente con l'inizio dello sweet spot (85% maturazione).
  const wH = params.warmupH ?? 0;
  const remainingH_appreto = Math.max(1, targetTotalH - staglioH - wH);
  // aduNeeded_appreto = ADU da accumulare nelle sole fasi puntata+freddo
  // (il resto verrà contribuito dallo stemperamento)
  const aduNeeded_appreto = Math.max(0.01, aduNeeded - (params.rampAdu ?? 0));
  const coldH_appreto = denominator > 1e-12
    ? (remainingH_appreto * rAmb - aduNeeded_appreto) / denominator
    : null;
  const warmH_appreto = coldH_appreto !== null ? remainingH_appreto - coldH_appreto : null;

  // ── TC Puntata ───────────────────────────────────────────────────────────────
  if (coldH_mixed !== null && warmH_mixed !== null && coldH_mixed > 0.5 && warmH_mixed > 0.5) {
    const { viability, note } = assessW(W, warmH_mixed, coldH_mixed);
    // matAtTarget: per costruzione rFri·coldH + rAmb·warmH = aduNeeded → 85% se targetTotalH è fornito
    const matAtTarget_puntata: number | undefined = params.targetTotalH !== undefined
      ? (() => {
          const aduAtBake = initialAdu + rFri * coldH_mixed + rAmb * warmH_mixed;
          const raw = (gompertz as Function)(aduAtBake, muMax, aParams.lambda, 100) as number;
          return isNaN(raw) ? undefined : Math.min(100, Math.max(0, raw));
        })()
      : undefined;
    results.push({
      protocol: 'tc_puntata', totalH: targetTotalH,
      tcHours: coldH_mixed, staglioH, apprettoH: warmH_mixed,
      matAtTarget: matAtTarget_puntata,
      viability, viabilityNote: note,
      label: 'TC Puntata',
      desc: `Puntata in frigo ${fmtHours(coldH_mixed)} · staglio ${fmtHours(staglioH)} · appretto ${fmtHours(warmH_mixed)}`,
      stars: viability === 'ok' ? 4 : 2,
    });
  }

  // ── TC Appreto ───────────────────────────────────────────────────────────────
  if (coldH_appreto !== null && warmH_appreto !== null && coldH_appreto > 0.5 && warmH_appreto > 0.5) {
    const { viability, note } = assessW(W, warmH_appreto, coldH_appreto);
    const warmupSuffix = wH > 0.05 ? ` · riscaldo ${fmtHours(wH)}` : '';
    // matAtTarget: ADU_totale @ targetBake = aduNeeded_appreto + rampAdu = aduNeeded → 85% per costruzione
    const matAtTarget_appreto: number | undefined = params.targetTotalH !== undefined
      ? (() => {
          const aduAtBake = initialAdu + rAmb * warmH_appreto + rFri * coldH_appreto + (params.rampAdu ?? 0);
          const raw = (gompertz as Function)(aduAtBake, muMax, aParams.lambda, 100) as number;
          return isNaN(raw) ? undefined : Math.min(100, Math.max(0, raw));
        })()
      : undefined;
    results.push({
      protocol: 'tc_appreto', totalH: targetTotalH,
      puntataH: warmH_appreto, staglioH, tcHours: coldH_appreto,
      warmupH: wH > 0.05 ? wH : undefined,
      matAtTarget: matAtTarget_appreto,
      viability, viabilityNote: note,
      label: 'TC Appretto',
      desc: `Puntata ${fmtHours(warmH_appreto)} · staglio ${fmtHours(staglioH)} · appretto in frigo ${fmtHours(coldH_appreto)}${warmupSuffix}`,
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
      : (() => {
          // Ramp tc_appreto: 5 sub-passi con T(t) = tAmb+(fridgeT-tAmb)·exp(-t/τ_approx)
          // τ_approx: sfera ~280g, hyd 65% → ~10800s (approssimazione fissa per la curva)
          const TAU_APPROX_S = 10800;
          const rampSegs = result.warmupH
            ? Array.from({ length: 5 }, (_, i) => {
                const t = (i + 0.5) * (result.warmupH! / 5) * 3600;
                const T = tAmb + (fridgeT - tAmb) * Math.exp(-t / TAU_APPROX_S);
                return { durationH: result.warmupH! / 5, tempC: T };
              })
            : [];
          return [
            { durationH: result.puntataH ?? 0, tempC: tAmb },
            { durationH: s,                    tempC: tAmb },
            { durationH: result.tcHours ?? 0,  tempC: fridgeT },
            ...rampSegs,
          ];
        })();

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
        stroke="rgba(232,213,176,0.4)" strokeWidth={1} strokeDasharray="3 2" />
      {/* End of protocol */}
      <line x1={xEnd} y1={0} x2={xEnd} y2={H_SVG}
        stroke="rgba(255,140,50,0.5)" strokeWidth={1} strokeDasharray="3 2" />
      {/* Curve */}
      <path d={pathD} fill="none" stroke="var(--accent-brand)" strokeWidth={1.5} />
    </svg>
  );
}

// ─── Card singolo protocollo ──────────────────────────────────────────────────
/**
 * I suggerimenti arrivano come testo dal motore (che non si tocca): qui si
 * sistemano solo gli arrotondamenti ("12h 60min" → "13h").
 */
function tidySuggestion(t: string): string {
  return t.replace(/(\d+)h\s*60\s*min/g, (_, h) => `${Number(h) + 1}h`);
}

/** Ore leggibili: "34h 05m" invece di "34.1h". */
function fmtHours(h: number): string {
  const tot = Math.max(0, Math.round(h * 60));
  const hh = Math.floor(tot / 60), mm = tot % 60;
  return hh === 0 ? `${mm} min` : `${hh}h ${String(mm).padStart(2, '0')}m`;
}

/** Target di maturazione della modalità Orario (costruzione analitica dei protocolli). */
const BAKE_TARGET_PCT = 85;

/** Esito rispetto al target: è la cosa che l'utente deve leggere, non la sola W. */
function outcomeOf(r: PlanResult): { label: string; color: string } | null {
  if (r.matAtTarget === undefined) return null;
  const d = r.matAtTarget - BAKE_TARGET_PCT;
  if (Math.abs(d) <= 7) return { label: 'Al target', color: 'var(--pm4-flour)' };
  return d < 0 ? { label: 'Sotto il target', color: 'var(--state-cold)' }
               : { label: 'Oltre il target', color: 'var(--pm4-ember)' };
}

/** Il protocollo consigliato: fattibile, più vicino al target, poi per stelle. */
function pickRecommended(results: PlanResult[]): PlanResult | null {
  const usable = results.filter(r => r.viability !== 'no');
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    // Arrotondati al punto percentuale: un rumore in virgola mobile non deve
    // cambiare il consigliato a dati identici (poi decidono W e stelle).
    const da = a.matAtTarget === undefined ? 99 : Math.round(Math.abs(a.matAtTarget - BAKE_TARGET_PCT));
    const db = b.matAtTarget === undefined ? 99 : Math.round(Math.abs(b.matAtTarget - BAKE_TARGET_PCT));
    if (da !== db) return da - db;
    if (a.viability !== b.viability) return a.viability === 'ok' ? -1 : 1;
    return b.stars - a.stars;
  })[0];
}

/** Orologio del piano: orari assoluti a partire da adesso. */
function planClock(r: PlanResult, startMs: number): Array<{ label: string; at: Date }> {
  const at = (h: number) => new Date(startMs + h * 3_600_000);
  const p = r.puntataH ?? 0, s = r.staglioH, tc = r.tcHours ?? 0;
  switch (r.protocol) {
    case 'ta':         return [{ label: 'Impasta', at: at(0) }, { label: 'Staglio', at: at(p) }, { label: 'Appretto', at: at(p + s) }, { label: 'Forno', at: at(r.totalH) }];
    case 'tc':         return [{ label: 'Impasta · in frigo', at: at(0) }, { label: 'Staglio', at: at(tc) }, { label: 'Forno', at: at(r.totalH) }];
    case 'tc_puntata': return [{ label: 'Impasta · in frigo', at: at(0) }, { label: 'Staglio', at: at(tc) }, { label: 'Appretto', at: at(tc + s) }, { label: 'Forno', at: at(r.totalH) }];
    default:           return [{ label: 'Impasta', at: at(0) }, { label: 'Staglio', at: at(p) }, { label: 'In frigo', at: at(p + s) }, { label: 'Fuori dal frigo', at: at(p + s + tc) }, { label: 'Forno', at: at(r.totalH) }];
  }
}
function fmtWhen(d: Date, nowMs: number): string {
  const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(nowMs).toDateString() ? t
    : `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })} ${t}`;
}

/** "Il tuo piano": la risposta in alto, con orari assoluti e un solo comando. */
function PlanSummaryCard({ result, nowMs, onUse, disabled, disabledReason }: {
  result: PlanResult; nowMs: number; onUse: () => void; disabled?: boolean; disabledReason?: string;
}) {
  const steps = planClock(result, nowMs);
  const outcome = outcomeOf(result);
  return (
    <section className="pm4-panel" aria-labelledby="pm-plan-title" style={{ padding: '13px 14px 14px', borderColor: 'rgba(255,140,50,0.45)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h2 id="pm-plan-title" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pm4-tan)', fontWeight: 400 }}>
          Il tuo piano · {result.label}
        </h2>
        {outcome && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: outcome.color }}>
            {outcome.label} · {result.matAtTarget!.toFixed(0)}%
          </span>
        )}
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((st, i) => (
          <li key={st.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <span style={{ color: i === steps.length - 1 ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)' }}>{st.label}</span>
            <span style={{ color: i === steps.length - 1 ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {fmtWhen(st.at, nowMs)}
            </span>
          </li>
        ))}
      </ol>
      {result.warmupH !== undefined && result.warmupH > 0.05 && (
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--state-cold)' }}>
          Fuori dal frigo serve un riscaldo di {fmtHours(result.warmupH)} prima del forno.
        </div>
      )}
      {result.viability !== 'ok' && result.viabilityNote && (
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-ember-lo)' }}>⚠ {result.viabilityNote}</div>
      )}
      <button type="button" onClick={onUse} disabled={disabled} className="pm-btn-primary" style={{
        marginTop: 12, width: '100%', minHeight: 48, background: 'var(--accent-brand)', color: 'var(--bg-primary)',
        border: 'none', borderRadius: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      }}>
        Usa questo piano →
      </button>
      {disabled && disabledReason && (
        <div role="status" style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-ember-lo)' }}>{disabledReason}</div>
      )}
    </section>
  );
}

function ProtocolCard({ result, aParams, agentType, tAmb, fridgeT, initialAdu, muMax, onUse, plannerErrors, recommended, disabled }: {
  result: PlanResult; aParams: { Ea: number; muMax: number; lambda: number };
  agentType: string; tAmb: number; fridgeT: number; initialAdu: number; muMax: number;
  onUse: () => void; plannerErrors?: string[];
  /** Il protocollo già proposto in "Il tuo piano": qui solo come riferimento. */
  recommended?: boolean;
  disabled?: boolean;
}) {
  const stars = '★'.repeat(result.stars) + '☆'.repeat(Math.max(0, 5 - result.stars));
  const outcome = outcomeOf(result);
  const blocked = disabled || !!(plannerErrors && plannerErrors.length > 0);
  // La W è un vincolo, non l'esito: compare solo quando è un problema.
  const wNote = result.viability === 'risky' ? '⚠ W al limite' : result.viability === 'no' ? '✗ W troppo bassa' : null;

  return (
    <div className="pm4-panel" style={{
      padding: '13px 14px 14px', opacity: result.viability === 'no' ? 0.6 : 1,
      borderColor: recommended ? 'rgba(255,140,50,0.45)' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--pm4-flour)' }}>
            {result.label}{recommended && <span style={{ color: 'var(--pm4-ember-lo)', fontSize: 11, marginLeft: 8 }}>consigliato</span>}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-umber)', marginTop: 2 }}>
            <span aria-label={`${result.stars} su 5`}>{stars}</span> · {fmtHours(result.totalH)} in tutto
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MiniCurve result={result} aParams={aParams} agentType={agentType}
            tAmb={tAmb} fridgeT={fridgeT} initialAdu={initialAdu} muMax={muMax} />
          {outcome && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: outcome.color, border: '1px solid var(--pm4-line-strong)', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>
              {outcome.label}
            </span>
          )}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)', marginBottom: 8, lineHeight: 1.5 }}>
        {result.desc}
      </div>

      {result.matAtTarget !== undefined && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 6, color: 'var(--pm4-tan)' }}>
          Maturazione all'orario scelto: <strong style={{ color: outcome?.color ?? 'var(--pm4-flour)' }}>{result.matAtTarget.toFixed(0)}%</strong>
          <span style={{ color: 'var(--pm4-umber)' }}> (target {BAKE_TARGET_PCT}%)</span>
        </div>
      )}

      {(wNote || result.viabilityNote) && result.viability !== 'ok' && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: result.viability === 'no' ? 'var(--state-critical)' : 'var(--pm4-ember-lo)', marginBottom: 8 }}>
          {wNote}{result.viabilityNote ? ` · ${result.viabilityNote}` : ''}
        </div>
      )}

      {result.viability !== 'no' && (
        <>
          {plannerErrors && plannerErrors.length > 0 && (
            <div role="alert" style={{
              border: '1px solid rgba(255,118,117,0.4)', borderRadius: 8, padding: '8px 12px', marginBottom: 8,
            }}>
              {plannerErrors.map((err, i) => (
                <p key={i} style={{ color: 'var(--state-critical)', fontSize: 12, margin: '2px 0', fontFamily: 'var(--font-mono)' }}>
                  ⚠ {err}
                </p>
              ))}
            </div>
          )}
          {!recommended && (
            <button type="button" onClick={onUse} disabled={blocked} className="pm4-btn pm4-btn-ghost" style={{
              background: 'rgba(255,255,255,0.04)', color: 'var(--pm4-tan)',
              border: '1px solid var(--pm4-line-strong)', borderRadius: 9,
              padding: '9px 14px', minHeight: 44, fontFamily: 'var(--font-mono)',
              fontWeight: 700, fontSize: 13,
              cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.45 : 1,
            }}>
              Usa questo
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Grammi lievito ──────────────────────────────────────────────────────────
function computeGrammiLievito(pesoFarinaG: number, dosePct: number, agentType: string): string {
  const grammi = (pesoFarinaG * dosePct) / 100;
  if (agentType === 'sourdough_wheat') return `${Math.round(grammi)}g lievito madre`;
  return `${grammi.toFixed(1)}g`;
}

// ─── Slider con label inline ──────────────────────────────────────────────────
function PlannerSlider({ label, value, onChange, min, max, step, unit, color }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string; color?: string;
}) {
  const id = useId();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label htmlFor={id} style={S.label}>{label}</label>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: color ?? 'var(--text-secondary)' }}>
          {value}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={`${value}${unit ? ` ${unit}` : ''}`}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color ?? 'var(--accent-brand)' }} />
    </div>
  );
}

// ─── Campo derivato (WP-1, v2.4.25) ───────────────────────────────────────────
// Valore read-only "vivo": alto contrasto (NON grigio spento), pill di spiegazione
// tappabile, micro-pulse al variare del valore (rispetta reduced-motion).
// È informazione viva derivata da un altro input, non un campo disabilitato.
function DerivedField({
  label, value, explanation, color = 'var(--pm4-flour)',
}: {
  label: string; value: string; explanation: string; color?: string;
}) {
  const reduced = useReducedMotion();
  const valRef  = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const descId = `derived-${label.replace(/\s+/g, '-').toLowerCase()}`;

  useEffect(() => {
    if (!reduced) pulseElement(valRef.current);
  }, [value, reduced]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 }}>
        <span style={S.label}>{label}</span>
        <span
          ref={valRef}
          aria-readonly="true"
          aria-describedby={descId}
          aria-label={`${label} ${value}, ${explanation}, sola lettura`}
          style={{
            display: 'inline-flex', alignItems: 'baseline', gap: 4,
            fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 700,
            color, fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '0.75rem', color: '#74b9ff' }}>∑</span>
          {value}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Badge tone="derived" onClick={() => setOpen(o => !o)} ariaLabel={`Spiegazione: ${explanation}`}>
          « {explanation} »
        </Badge>
      </div>
      {open && (
        <p id={descId} style={{
          margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
          color: 'var(--text-secondary)', lineHeight: 1.5, textAlign: 'right',
        }}>
          Valore calcolato dal solver: non modificabile direttamente. Cambia gli obiettivi sensoriali per aggiornarlo.
        </p>
      )}
      {!open && <span id={descId} style={{ display: 'none' }}>{explanation}, sola lettura</span>}
    </div>
  );
}

// ─── Card risultato finestra di servizio ─────────────────────────────────────
function ConstraintChip({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', borderRadius: 6,
      background: ok ? 'rgba(232,213,176,0.06)' : 'rgba(214,48,49,0.1)',
      border: `1px solid ${ok ? 'var(--pm4-line-strong)' : 'rgba(214,48,49,0.25)'}`,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        {ok ? '✓' : '✗'} {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700,
        color: ok ? 'var(--pm4-flour)' : 'var(--state-critical)' }}>
        {value}
      </span>
    </div>
  );
}

function ServiceWindowResultCard({ result, serviceStart, serviceDurationH, bubbleThresholdPct, puntataKickoffH, onUse, plannerErrors }: {
  result: NowAnchoredAlarmResult; serviceStart: Date | null;
  serviceDurationH: number; bubbleThresholdPct: number; puntataKickoffH: number; onUse: () => void; plannerErrors?: string[];
}) {
  const inf = result.infeasibility;

  // ── Infeasible: SOVRAMMATURAZIONE con opzioni esplicite ───────────────────
  if (!result.feasible && result.alarmType === 'SOVRAMMATURAZIONE') {
    return (
      <Card style={{ border: '1px solid rgba(214,48,49,0.35)', background: 'rgba(214,48,49,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--state-critical)' }}>↑</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.82rem', color: 'var(--state-critical)' }}>
            SOVRAMMATURAZIONE — Impossibile rallentare abbastanza
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Partendo adesso, anche al frigo minimo ({inf?.maturationAtMin?.toFixed(0) ?? '—'}% a fine servizio), la maturazione supera il target del {result.resolvedTargetMaturationPct ?? 90}%.
        </div>
        {result.suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <span style={{ ...S.label, color: 'var(--text-muted)' }}>Opzioni (scegli tu)</span>
            {result.suggestions.map((opt, i) => {
              const isLast = opt.startsWith('[Ultima opzione]');
              return (
                <div key={i} style={{
                  padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                  background: isLast ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)',
                  border: isLast ? '1px dashed var(--pm4-line-strong)' : '1px solid var(--pm4-line-strong)',
                  color: isLast ? 'var(--text-muted)' : 'var(--text-secondary)',
                  opacity: isLast ? 0.75 : 1,
                }}>
                  {isLast ? '↩ ' : '→ '}{tidySuggestion(opt.replace('[Ultima opzione] ', ''))}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  // ── Infeasible: SOTTOMATURAZIONE / altri ─────────────────────────────────
  if (!result.feasible) {
    return (
      <Card style={{ border: '1px solid rgba(214,48,49,0.3)', background: 'rgba(214,48,49,0.05)' }}>
        <div style={{ ...S.label, marginBottom: 10, color: 'var(--state-critical)' }}>
          {result.alarmType === 'SOTTOMATURAZIONE'     ? '↓ SOTTOMATURAZIONE — Finestra troppo corta'
           : result.alarmType === 'COLLASSO_STRUTTURALE' ? '⚠ COLLASSO STRUTTURALE'
           : '✗ Finestra non realizzabile'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
          {inf?.reason === 'cannot_temper' && 'A questa temperatura ambiente le palline non raggiungono 18°C.'}
          {inf?.reason === 'window_too_short' && 'Tempo insufficiente per puntata + appretto + tempering + servizio.'}
          {inf?.reason === 'window_too_short_maturation' && `La maturazione a fine servizio sarebbe solo ${inf.maturationAtMax?.toFixed(0) ?? '—'}% (target ${result.resolvedTargetMaturationPct ?? 90}%).`}
          {inf?.reason === 'w_collapse' && 'La struttura del glutine collasserebbe prima della fine del servizio.'}
          {inf?.reason === 'bubble_threshold_lm_unscalable' && 'Lievito madre: la lievitazione supera la soglia bolle e la dose non è scalabile abbastanza.'}
        </div>
        {result.suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {result.suggestions.map((m, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)' }}>· {tidySuggestion(m)}</div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  const s = result.schedule!;
  const end = result.atServiceEnd!;
  const start = result.atServiceStart!;
  const c1ok = start.tempDough >= 18 - 0.3;
  const resolvedTarget = result.resolvedTargetMaturationPct ?? 90;
  const c2ok = end.maturationPct <= resolvedTarget + 0.5 && end.structuralStatus !== 'CRITICAL' && end.structuralStatus !== 'COLLAPSED';
  const c3ok = !result.bubbleCapped && end.leaveningPct <= bubbleThresholdPct + 0.5;
  const pullFromFridge = serviceStart ? new Date(serviceStart.getTime() - s.temperingH * 3_600_000) : null;
  const fridgeDisplay = result.recommendedFridgeTempC != null
    ? `${result.recommendedFridgeTempC}°C`
    : null;

  // Tensione del piano: avvisi del solver che rendono il piano "al limite".
  const tightMargin = result.maxSafeServiceWindowH != null && result.maxSafeServiceWindowH < serviceDurationH;
  const atLimit = tightMargin || result.matWarning === 'NEAR_CEILING' || !!result.bubbleCapped;
  const mixAt = result.mixStart ?? result.now ?? new Date();
  const clock = (d: Date) => {
    const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date(mixAt).toDateString() ? t
      : `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })} ${t}`;
  };
  const plus = (h: number) => new Date(new Date(mixAt).getTime() + h * 3_600_000);
  const steps: Array<{ label: string; at: Date }> = [
    { label: 'Impasta', at: new Date(mixAt) },
    { label: 'Staglio', at: plus(s.puntataH) },
    { label: 'In frigo', at: plus(s.puntataH + s.staglioH) },
    ...(pullFromFridge ? [{ label: 'Fuori dal frigo', at: pullFromFridge }] : []),
  ];
  const blocked = !!(plannerErrors && plannerErrors.length > 0);

  return (
    <section className="pm4-panel" aria-labelledby="pm-service-title" style={{ padding: '13px 14px 14px', borderColor: 'rgba(255,140,50,0.45)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h2 id="pm-service-title" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pm4-tan)', fontWeight: 400 }}>
          Il tuo piano · Servizio
        </h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: atLimit ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)' }}>
          {atLimit ? 'Fattibile, al limite' : 'Fattibile'}
        </span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map(st => (
          <li key={st.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <span style={{ color: 'var(--pm4-tan)' }}>{st.label}</span>
            <span style={{ color: 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{clock(st.at)}</span>
          </li>
        ))}
        {serviceStart && (
          <li style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <span style={{ color: 'var(--pm4-ember-lo)' }}>Servizio</span>
            <span style={{ color: 'var(--pm4-ember-lo)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {clock(serviceStart)}–{clock(new Date(serviceStart.getTime() + serviceDurationH * 3_600_000))}
            </span>
          </li>
        )}
      </ol>
      <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)', lineHeight: 1.5 }}>
        Pronta a inizio servizio ({start.maturationPct.toFixed(0)}%), regge fino alla fine ({end.maturationPct.toFixed(0)}%).
        {fridgeDisplay && result.fridgeTempAdjusted && <><br />Imposta il frigo a {fridgeDisplay}.</>}
      </div>
      {atLimit && (
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-ember-lo)', lineHeight: 1.5 }}>
          {tightMargin && <>⚠ La finestra sicura è ~{fmtHours(result.maxSafeServiceWindowH!)}: oltre, l'impasto rischia di cedere.<br /></>}
          {result.matWarning === 'NEAR_CEILING' && <>⚠ Maturazione al limite a fine servizio: abbassa il target di 1–2 punti.<br /></>}
          {result.bubbleCapped && <>⚠ Lievito già al minimo: a fine servizio la lievitazione supera la soglia bolle.</>}
        </div>
      )}

      {plannerErrors && plannerErrors.length > 0 && (
        <div role="alert" style={{ marginTop: 8, border: '1px solid rgba(255,118,117,0.4)', borderRadius: 8, padding: '8px 12px' }}>
          {plannerErrors.map((err, i) => (
            <p key={i} style={{ color: 'var(--state-critical)', fontSize: 12, margin: '2px 0', fontFamily: 'var(--font-mono)' }}>⚠ {err}</p>
          ))}
        </div>
      )}
      <button type="button" onClick={onUse} disabled={blocked} className="pm-btn-primary" style={{
        marginTop: 12, width: '100%', minHeight: 48, background: 'var(--accent-brand)', color: 'var(--bg-primary)',
        border: 'none', borderRadius: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14,
        cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.45 : 1,
      }}>
        Usa questo piano →
      </button>

      {/* Il dettaglio del solver resta disponibile, ma non è la risposta */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)' }}>
          Dettagli: durate, dose, vincoli
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <PlanRow label="Dose lievito" value={`${result.dose?.toFixed(2)}%`} />
          <PlanRow label="Puntata" value={fmtHours(s.puntataH)} />
          <PlanRow label="Staglio" value={fmtHours(s.staglioH)} />
          <PlanRow label="Appretto in frigo" value={fmtHours(s.tcHours)} />
          <PlanRow label="Riscaldo (frigo → 18°C)" value={fmtHours(s.temperingH)} />
          <ConstraintChip ok={c1ok} label="Impasto caldo a inizio servizio" value={`${start.tempDough.toFixed(1)}°C`} />
          <ConstraintChip ok={c2ok} label="Maturazione a fine servizio" value={`${end.maturationPct.toFixed(0)}% (target ${result.resolvedTargetMaturationPct ?? 90}%)`} />
          <ConstraintChip ok={c3ok} label="Lievitazione a fine servizio" value={`${end.leaveningPct.toFixed(0)}% / ${bubbleThresholdPct}%`} />
          {result.puntataMaxH != null && result.effectivePuntataH != null && result.effectivePuntataH < puntataKickoffH && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)' }}>
              Puntata ridotta a {fmtHours(result.effectivePuntataH)} (massimo per lo stile {fmtHours(result.puntataMaxH)}): il resto va in frigo.
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

// ─── Inverse Quality Profile Solver ─────────────────────────────────────────

interface QualityTargets {
  extTarget:   number;   // 1–5
  aromaTarget: number;   // 1–5
  sciTarget:   number;   // 1–5
}

/**
 * Breakdown additivo (WP-0, v2.4.25) — espone le variabili intermedie GIÀ calcolate
 * da solveQualityProfile per il rendering della UI (card credito, cap esplicito, campi
 * derivati). NON ricalcola fisica: solo esposizione. Two-Clock invariato.
 */
interface QualitySolveBreakdown {
  aduTarget:          number;
  aduFridge:          number;
  prefEnzAdu:         number;   // 0 se nessun prefermento suggerito
  aduNeeded:          number;
  kAmbRate:           number;
  puntataRaw:         number;   // = aduNeeded / kAmbRate (con credito enzimatico)
  puntataRawNoCredit: number;   // = (aduTarget − aduFridge) / kAmbRate (senza credito)
  puntataCapped:      number;   // = clamp(puntataRaw, range) — uguale a puntataH
  capped:             boolean;  // puntataCapped !== puntataRaw oltre tolleranza 0.05h
  rangeTa:            [number, number];  // STYLE_PROFILES[style].puntataH_range_ta
  hydRef:             number;   // 60 + (extTarget − 1) × 4
  prefermentoSuggested: { type: 'poolish' | 'biga'; fraction: number; durationH: number; tempC: number } | null;
}

interface QualityResult {
  // Required maturation
  mTarget:          number;   // [0,1] — reconciled
  mFromExt:         number;
  mFromSci_lo:      number;   // below bell peak
  mFromSci_hi:      number;   // above bell peak
  // Conflict flags
  conflictExtSci:   boolean;  // max ext + max sci incompatible
  // Suggested protocol parameters
  hydration:        number;   // %
  prefType:         'none' | 'biga' | 'poolish' | 'riporto';
  prefFrac:         number;   // % farina
  prefDurH:         number;   // ore
  prefTempC:        number;   // °C
  prefYeastPct:     number;
  agentType:        'fresh_yeast' | 'sourdough_wheat';
  tcHours:          number;
  puntataH:         number;
  staglioH:         number;
  apprettoProtocol: 'ta' | 'tc_appreto';
  // Predicted profile at mTarget
  predictedExt:     number;
  predictedAroma:   number;
  predictedSci:     number;
  // Schedule
  totalH:           number;
  // WP-0 (v2.4.25): variabili intermedie esposte per la UI (additivo)
  breakdown:        QualitySolveBreakdown;
}

/** Inverte il profilo qualità: dai target (1–5) ricava parametri di protocollo. */
export function solveQualityProfile(
  targets: QualityTargets,
  flour: { W: number; pl: number },
  style: string,
  tAmb: number,
  fridgeT: number,
  staglioH: number,
): QualityResult {
  const { extTarget, aromaTarget, sciTarget } = targets;
  const { W, pl } = flour;

  // ── Invert Estensibilità → m_ext ──────────────────────────────────────────
  // ext = round(3m + flourContr);  flourContr depends on pl and hydration.
  // Use hydration of 65% as reference for inversion; hydration will be set below.
  const hydRef = 60 + (extTarget - 1) * 4;  // 60–76% range mapped to ext 1–5
  const plScore   = Math.max(0.5, Math.min(2.0, (1.2 - pl) / 0.35));
  const hydScore  = 0.5 + Math.max(0, Math.min(1.0, (hydRef - 55) / 30));
  const flourContr = (plScore + hydScore) / 2;
  const mFromExt = Math.max(0.5, Math.min(0.99, (extTarget - 0.5 - flourContr) / 3.0));

  // ── Invert Scioglievolezza → m_sci ────────────────────────────────────────
  // sci = round(1 + 3*sciMat + hydBon + amylBon + wBon + styleSci)
  const styleSci: Record<string, number> = { napoletana: 0.3, contemporanea: 0.2, teglia: 0.0, pala: 0.1, nystyle: -0.2 };
  const hydBon   = Math.max(0, Math.min(0.8, (hydRef - 55) / 50));
  const wBon     = Math.max(0, Math.min(0.3, (350 - W) / 500));
  const sciBonus = hydBon + wBon + (styleSci[style] ?? 0);
  const sciMat_needed = Math.max(0, Math.min(1, (sciTarget - 0.5 - 1 - sciBonus) / 3.0));
  const delta    = 0.5 * Math.sqrt(Math.max(0, 1 - sciMat_needed));
  const mFromSci_lo = Math.max(0, 0.87 - delta);   // below peak
  const mFromSci_hi = Math.min(1, 0.87 + delta);   // above peak

  // ── Prefermento e aromi ───────────────────────────────────────────────────
  let prefType: 'none' | 'biga' | 'poolish' | 'riporto' = 'none';
  let prefFrac = 0, prefDurH = 0, prefTempC = 18, prefYeastPct = 0;
  let agentType: 'fresh_yeast' | 'sourdough_wheat' = 'fresh_yeast';
  let prefContrib = 0;
  const sdContrib = 0;

  if (aromaTarget >= 5) {
    prefType = 'biga'; prefFrac = 50; prefDurH = 18; prefTempC = 16; prefYeastPct = 0.10;
    prefContrib = 1.2;
  } else if (aromaTarget >= 4) {
    prefType = 'biga'; prefFrac = 30; prefDurH = 16; prefTempC = 18; prefYeastPct = 0.10;
    prefContrib = 1.2;
  } else if (aromaTarget >= 3) {
    prefType = 'poolish'; prefFrac = 20; prefDurH = 12; prefTempC = 20; prefYeastPct = 0.05;
    prefContrib = 0.8;
  }

  // Calcola coldContrib necessaria per aromi residui
  const mTarget0 = Math.max(mFromExt, mFromSci_lo);
  const aromaFromM = 1.0 + 2.0 * mTarget0 + prefContrib + sdContrib;
  const coldNeeded = Math.max(0, aromaTarget - 0.5 - aromaFromM);
  const tcHours = coldNeeded > 0 ? Math.max(8, Math.min(48, coldNeeded * 24)) : 0;
  const coldContrib = tcHours > 8 ? Math.min(1.0, tcHours / 24) : 0;

  // ── Reconcile mTarget ─────────────────────────────────────────────────────
  let mTarget = mFromExt;
  if (mFromExt > mFromSci_hi) {
    mTarget = mFromExt;  // conflitto: ext vince, sci calerà
  } else if (mFromExt > 0.87) {
    mTarget = Math.max(mFromExt, mFromSci_hi);
  } else {
    mTarget = Math.max(mFromExt, mFromSci_lo);
  }
  mTarget = Math.max(0.5, Math.min(0.99, mTarget));

  const conflictExtSci = extTarget >= 5 && sciTarget >= 5 && mFromExt > mFromSci_hi + 0.05;

  // ── Schedule da mTarget ──────────────────────────────────────────────────
  const enzMu  = ENZYMATIC_CLOCK_PARAMS.muMax;
  const enzLam = ENZYMATIC_CLOCK_PARAMS.lambda;
  const aduTarget = (findAduAt as Function)(enzMu, enzLam, 100, mTarget * 100) as number;
  const aduFridge = (fArrhenius as Function)(fridgeT) as number * tcHours;
  // Accredita l'ADU enzimatico maturato durante il prefermento (proteolisi già avanzata)
  const prefEnzAdu = prefType !== 'none'
    ? ((fArrhenius as Function)(prefTempC) as number) * prefDurH * (prefFrac / 100)
    : 0;
  const aduNeeded = Math.max(0.1, aduTarget - aduFridge - prefEnzAdu);
  const kAmbRate  = (fArrhenius as Function)(tAmb) as number;
  // Cap puntata al range stile (evita puntate irrealisticamente lunghe)
  const styleProf = (getStyleProfile as Function)(style) as { puntataH_range_ta: [number, number] };
  const puntataRaw = aduNeeded / Math.max(0.01, kAmbRate);
  const puntataH   = Math.min(
    styleProf.puntataH_range_ta[1],
    Math.max(styleProf.puntataH_range_ta[0], puntataRaw),
  );

  // ── Predicted profile at mTarget ──────────────────────────────────────────
  const hydFinal    = hydRef;
  const hSc         = 0.5 + Math.max(0, Math.min(1.0, (hydFinal - 55) / 30));
  const fC          = (plScore + hSc) / 2;
  const sciMatFinal = Math.max(0, Math.min(1, 1 - Math.pow(mTarget - 0.87, 2) / 0.25));
  const hydBonF     = Math.max(0, Math.min(0.8, (hydFinal - 55) / 50));
  const wBonF       = Math.max(0, Math.min(0.3, (350 - W) / 500));

  const predictedExt   = Math.max(1, Math.min(5, Math.round(3 * mTarget + fC)));
  const predictedAroma = Math.max(1, Math.min(5, Math.round(1 + 2 * mTarget + prefContrib + coldContrib + sdContrib)));
  const predictedSci   = Math.max(1, Math.min(5, Math.round(1 + 3 * sciMatFinal + hydBonF + 0 + wBonF + (styleSci[style] ?? 0))));

  const totalH = puntataH + staglioH + tcHours;

  // ── WP-0 (v2.4.25): breakdown additivo — solo esposizione, nessuna nuova fisica ──
  const puntataRawNoCredit = Math.max(0.1, aduTarget - aduFridge) / Math.max(0.01, kAmbRate);
  const breakdown: QualitySolveBreakdown = {
    aduTarget, aduFridge, prefEnzAdu, aduNeeded, kAmbRate,
    puntataRaw,
    puntataRawNoCredit,
    puntataCapped: puntataH,
    capped: Math.abs(puntataH - puntataRaw) > 0.05,
    rangeTa: styleProf.puntataH_range_ta,
    hydRef,
    prefermentoSuggested: (prefType === 'biga' || prefType === 'poolish')
      ? { type: prefType, fraction: prefFrac, durationH: prefDurH, tempC: prefTempC }
      : null,
  };

  return {
    mTarget, mFromExt, mFromSci_lo, mFromSci_hi, conflictExtSci,
    hydration: Math.round(hydRef), prefType, prefFrac, prefDurH, prefTempC, prefYeastPct,
    agentType, tcHours: parseFloat(tcHours.toFixed(1)),
    puntataH: parseFloat(puntataH.toFixed(1)), staglioH,
    apprettoProtocol: tcHours > 0 ? 'tc_appreto' : 'ta',
    predictedExt, predictedAroma, predictedSci,
    totalH: parseFloat(totalH.toFixed(1)),
    breakdown,
  };
}

// ─── Quality Profile Result Card ─────────────────────────────────────────────
function QualityDotRow({ label, target, predicted, color }: { label: string; target: number; predicted: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)', width: 100 }}>{label}</span>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i < predicted ? color : 'rgba(255,255,255,0.1)',
            border: target > 0 && i === target - 1 ? '2px solid var(--pm4-flour)' : 'none',
          }} />
        ))}
      </div>
      {/* target ≤ 0 = nessun obiettivo per questo indice: si mostra solo il previsto */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: target <= 0 || predicted === target ? 'var(--pm4-flour)' : 'var(--pm4-ember-lo)', minWidth: 36, textAlign: 'right' }}>
        {target <= 0 || predicted === target ? `${predicted}/5` : `${predicted} su ${target}`}
      </span>
    </div>
  );
}

function QualityProfileResultCard({ result, onUse, plannerErrors }: { result: QualityResult; onUse: () => void; plannerErrors?: string[] }) {
  const prefLabels = { none: 'Diretto', biga: 'Biga', poolish: 'Poolish', riporto: 'Riporto' };
  return (
    <Card elevated>
      <div style={{ ...S.label, marginBottom: 10 }}>Il tuo piano · Qualità</div>
      {/* Il prefermento non è istantaneo: la sessione parte dalla sua preparazione. */}
      {result.prefType !== 'none' && (
        <div style={{ marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: 'var(--pm4-ember-lo)',
          border: '1px solid rgba(255,140,50,0.35)', borderRadius: 8, padding: '8px 12px' }}>
          Si parte {result.prefType === 'biga' ? 'dalla biga' : `dal ${prefLabels[result.prefType].toLowerCase()}`}: {fmtHours(result.prefDurH)} a {result.prefTempC}°C.
          Dal riepilogo {result.prefType === 'biga' ? 'la' : 'lo'} impasti subito: ti avviso quando è {result.prefType === 'biga' ? 'pronta' : 'pronto'} e da lì parte l'impasto.
        </div>
      )}

      {result.conflictExtSci && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: 'rgba(255,140,50,0.08)', border: '1px solid rgba(255,140,50,0.25)',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-warning)',
        }}>
          ⚠ Estensibilità 5/5 e Scioglievolezza 5/5 sono incompatibili — la maturazione necessaria per ext=5 supera il picco di scioglievolezza (87%). Il piano ottimizza l'estensibilità.
        </div>
      )}

      {/* Maturazione target */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, padding: '8px 12px',
        background: 'rgba(230,200,74,0.08)', borderRadius: 6, border: '1px solid rgba(230,200,74,0.2)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Maturazione target</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: '#e6c84a' }}>
            {(result.mTarget * 100).toFixed(0)}%
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Idratazione</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-info)' }}>
            {result.hydration}%
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Totale</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {result.totalH.toFixed(0)}h
          </div>
        </div>
      </div>

      {/* Credito del prefermento — Two-Clock visivo (WP-2): riga enzimatica
          (la biga matura accorcia la puntata). Spiega il "crollo" altrimenti
          percepito come bug. */}
      {result.breakdown.prefEnzAdu > 0 && (
        <div style={{ marginBottom: 14 }}>
          <PrefermentCreditCard
            prefLabel={`${prefLabels[result.prefType]} ${result.prefFrac}% · ${result.prefDurH}h`}
            enzymatic={{
              puntataBefore: result.breakdown.puntataRawNoCredit,
              puntataAfter:  result.breakdown.puntataRaw,
              aduTarget:     result.breakdown.aduTarget,
              aduFridge:     result.breakdown.aduFridge,
              prefEnzAdu:    result.breakdown.prefEnzAdu,
              aduNeeded:     result.breakdown.aduNeeded,
            }}
          />
        </div>
      )}

      {/* Schedule compatto */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
        {result.prefType !== 'none' && (
          <PlanRow label={`${prefLabels[result.prefType]} (${result.prefFrac}% farina)`}
            value={`${result.prefDurH}h a ${result.prefTempC}°C · lievito ${result.prefYeastPct}%`} />
        )}
        <PlanRow label="Puntata TA" value={`${result.puntataH.toFixed(1)}h`} />
        {result.breakdown.capped && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: '#74b9ff',
            lineHeight: 1.45, paddingLeft: 2,
          }}>
            Cappata a {result.breakdown.puntataCapped.toFixed(1)}h dal profilo stile
            (range {result.breakdown.rangeTa[0]}–{result.breakdown.rangeTa[1]}h).
            Il target chiederebbe {result.breakdown.puntataRaw.toFixed(1)}h.
          </div>
        )}
        <PlanRow label="Staglio" value={`${result.staglioH.toFixed(1)}h`} />
        {result.tcHours > 0 && <PlanRow label="Appretto TC (frigo)" value={`${result.tcHours.toFixed(1)}h`} />}
        <PlanRow label="Protocollo" value={result.apprettoProtocol === 'tc_appreto' ? 'TC Appretto' : 'Tutto a temperatura ambiente'} />
      </div>

      {/* Profilo previsto vs target */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <span style={{ ...S.label, fontSize: '0.65rem' }}>Profilo previsto (●) vs target (○)</span>
        <QualityDotRow label="Estensibilità"   target={Math.round(result.mFromExt * 3 + 1)} predicted={result.predictedExt}   color="var(--pref-autolisi, #74b9ff)" />
        <QualityDotRow label="Aromi"           target={-1} predicted={result.predictedAroma} color="var(--accent-warning)" />
        <QualityDotRow label="Scioglievolezza" target={-1} predicted={result.predictedSci}   color="var(--pm4-ember)" />
      </div>

      {plannerErrors && plannerErrors.length > 0 && (
        <div style={{
          background: 'rgba(255,118,117,0.15)', border: '1px solid #ff7675',
          borderRadius: 8, padding: '8px 12px', marginBottom: 8,
        }}>
          {plannerErrors.map((err, i) => (
            <p key={i} style={{ color: '#ff7675', fontSize: 13, margin: '2px 0', fontFamily: 'var(--font-mono)' }}>
              ⚠ {err}
            </p>
          ))}
        </div>
      )}
      <button onClick={onUse} disabled={!!(plannerErrors && plannerErrors.length > 0)} style={{
        background: 'var(--accent-brand)', color: '#0a0806', border: 'none',
        borderRadius: 'var(--radius-sm)', padding: '8px 16px', minHeight: 44, fontFamily: 'var(--font-mono)',
        fontWeight: 700, fontSize: '0.8rem',
        cursor: plannerErrors && plannerErrors.length > 0 ? 'not-allowed' : 'pointer',
        opacity: plannerErrors && plannerErrors.length > 0 ? 0.4 : 1,
      }}>
        Usa questo schema →
      </button>
    </Card>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
    </div>
  );
}

// ─── Vista principale ─────────────────────────────────────────────────────────
// ─── Stato del planner conservato (sessionStorage) ───────────────────────────
// Tornando dal wizard con "← Planner" il planner resta com'era. Solo comodità
// per chi lo sta usando: se lo storage non c'è, si riparte dai default.
function usePlannerState<T>(key: string, init: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(`pm-planner:${key}`);
      return raw != null ? (JSON.parse(raw) as T) : init;
    } catch { return init; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(`pm-planner:${key}`, JSON.stringify(value)); } catch { /* storage non disponibile */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export function FermentationPlannerView() {
  const { dispatch } = useApp();

  // Parametri farina + agente
  const [W,           setW]           = usePlannerState('W', 280);
  const [flourPl,     setFlourPl]     = usePlannerState('flourPl', 0.55);
  const [flourProtein,setFlourProtein]= usePlannerState('flourProtein', 12.5);
  const [selectedFlourId, setSelectedFlourId] = usePlannerState('selectedFlourId', '');
  const [agentType,   setAgentType]   = usePlannerState<'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat'>('agentType', 'fresh_yeast');
  const [dosePct,     setDosePct]     = usePlannerState('dosePct', 0.3);
  const [tAmb,          setTAmb]          = usePlannerState('tAmb', 22);
  const [fridgeT,       setFridgeT]       = usePlannerState('fridgeT', 4);
  const [staglioH,      setStaglioH]      = usePlannerState('staglioH', 0.5);
  const [salt,          setSalt]          = usePlannerState('salt', 2.0);
  const [kneadingMethod, setKneadingMethod] = usePlannerState<KneadingMethod>('kneadingMethod', 'spiral');

  // Parametri impasto (per il wizard)
  const [style,       setStyle]       = usePlannerState<'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle'>('style', 'napoletana');
  const [totalFlourG, setTotalFlourG] = usePlannerState('totalFlourG', 500);
  const [hydration,   setHydration]   = usePlannerState('hydration', 65);
  const [numPanetti,  setNumPanetti]  = usePlannerState('numPanetti', 4);

  // Handler reattivi numPanetti ↔ pesoPanetto → farina
  const handleNumPanettiChange = (val: number) => {
    setNumPanetti(val);
    if (!farinaManuale) {
      setTotalFlourG(Math.max(50, Math.round((val * pesoPanetto) / (1 + hydration / 100 + salt / 100))));
    }
  };
  const handlePesoPanettoChange = (val: number) => {
    setPesoPanetto(val);
    if (!farinaManuale) {
      setTotalFlourG(Math.max(50, Math.round((numPanetti * val) / (1 + hydration / 100 + salt / 100))));
    }
  };
  const handleFarinaChange = (val: number) => {
    setTotalFlourG(val);
    setFarinaManuale(true);
  };
  const resetFarinaCalcolata = () => {
    setFarinaManuale(false);
    setTotalFlourG(Math.max(50, Math.round((numPanetti * pesoPanetto) / (1 + hydration / 100 + salt / 100))));
  };

  // Target cottura
  const [targetDate,  setTargetDate]  = usePlannerState('targetDate', '');
  const [targetTime,  setTargetTime]  = usePlannerState('targetTime', '12:00');

  // ── Modalità pianificatore: 'bake' (ora di cottura) | 'service' (finestra servizio) ──
  const [plannerMode, setPlannerMode] = usePlannerState<'bake' | 'service' | 'quality'>('plannerMode', 'bake');

  // ── Modalità Profilo Qualità ───────────────────────────────────────────────
  const [extTarget,   setExtTarget]   = usePlannerState('extTarget', 3);
  const [aromaTarget, setAromaTarget] = usePlannerState('aromaTarget', 3);
  const [sciTarget,   setSciTarget]   = usePlannerState('sciTarget', 3);
  const [serviceDate, setServiceDate] = usePlannerState('serviceDate', '');
  const [serviceTime, setServiceTime] = usePlannerState('serviceTime', '19:00');
  const [serviceDurationH, setServiceDurationH] = usePlannerState('serviceDurationH', 2);
  const [userBubbleThresholdPct, setUserBubbleThresholdPct] = usePlannerState<number | null>('userBubbleThresholdPct', null);
  const [userTargetMatPct, setUserTargetMatPct] = usePlannerState<number | null>('userTargetMatPct', null);

  // Clock reattivo per countdown live (KB §11.3 — evita Date.now() in useMemo)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Ore fino alla cottura (per passare targetTotalH a computeAllProtocols)
  const hoursUntilBake = useMemo(() => {
    if (!targetDate) return undefined;
    const bakeMs = new Date(`${targetDate}T${targetTime}`).getTime();
    const diffMs = bakeMs - nowMs;
    return diffMs > 0 ? diffMs / 3_600_000 : undefined;
  }, [targetDate, targetTime, nowMs]);

  // Mix farine (blend builder)
  const [useBlend,     setUseBlend]    = usePlannerState('useBlend', false);
  const [blendFlours,  setBlendFlours] = usePlannerState<{ W: number; pct: number }[]>('blendFlours', [{ W: 300, pct: 100 }]);

  // W effettivo: da blend o da slider singolo
  const effectiveBlendW = useBlend && blendFlours.length > 0
    ? Math.round(blendFlours.reduce((s, f) => s + f.W * f.pct / 100, 0))
    : null;

  // Peso panetto e flag override manuale farina (MODIFICA 2B)
  const [pesoPanetto,   setPesoPanetto]   = usePlannerState('pesoPanetto', 250);
  const [farinaManuale, setFarinaManuale] = usePlannerState('farinaManuale', false);

  // Bug #65: ricalcola farina quando idratazione o sale cambiano (a meno di override manuale)
  useEffect(() => {
    if (farinaManuale) return;
    const divisore = 1 + hydration / 100 + salt / 100;
    if (divisore <= 0) return;
    setTotalFlourG(Math.max(50, Math.round((numPanetti * pesoPanetto) / divisore)));
  }, [numPanetti, pesoPanetto, hydration, salt, farinaManuale]);

  // Prefermento rimosso dal planner (v2.4.6) — sempre null per il solver di servizio
  const pref: PrefConfig | null = null;

  // Validazione input planner (Bug #66B): errori mostrati nei card prima di "Usa questo schema"
  const plannerErrors = useMemo(
    () => validatePlannerInputs(totalFlourG, numPanetti, hydration),
    [totalFlourG, numPanetti, hydration],
  );

  // Parametri agente Gompertz
  const agent   = AGENT_GOMPERTZ as any;
  const aParams = agent[agentType] as { Ea: number; muMax: number; lambda: number };

  // Dose di riferimento per scaling muMax
  const doseRef = agentType === 'fresh_yeast' ? 0.3 : agentType === 'instant_dry_yeast' ? 0.1 : null;
  const { effectiveDose, initialAdu } = useMemo(
    () => computeEffectiveDoseAndAdu(pref, dosePct, aParams.Ea, agentType),
    [pref, dosePct, aParams.Ea, agentType],
  );
  const muMax = (scaleMuMaxByDose as Function)(aParams.muMax, effectiveDose, doseRef) as number;

  // Massa panetto — usata per riscaldo e integrazione ramp tc_appreto
  const panMassKg = (totalFlourG * (1 + hydration / 100 + salt / 100)) / 1000 / Math.max(1, numPanetti);
  // Stesso contenitore che il wizard userà di default (cassetta chiusa): il riscaldo
  // del piano coincide con quello che la dashboard simulerà.
  const plannerTauMult = (CONTAINER_THERMAL_PRESETS as Record<string, { tauMultiplier: number }>)['closed_box']?.tauMultiplier ?? 1.0;
  const warmupHPlanner = computeWarmupH(panMassKg, hydration, fridgeT, tAmb, plannerTauMult);

  // ADU accumulato durante lo stemperamento (integrazione Riemann N=20)
  // Sottratto da aduNeeded prima di risolvere il split TA/TC per tc_appreto,
  // garantendo che target bake ≡ inizio sweet spot (85% maturazione).
  const rampAduPlanner = (() => {
    if (warmupHPlanner <= 0) return 0;
    const kRef = (kEffective as Function)(25, aParams.Ea, agentType) as number;
    return computeRampAdu(panMassKg, hydration, fridgeT, tAmb, warmupHPlanner, aParams.Ea, agentType, kRef, plannerTauMult);
  })();

  // W effettivo passato al solver — usa blend se attivo, altrimenti slider singolo
  const solverW = effectiveBlendW ?? W;

  // Calcolo ottimale per tutti i protocolli (targetTotalH dalle ore fino a cottura)
  const results = useMemo(() => {
    try {
      return computeAllProtocols({ W: solverW, agentType, agentDosePct: dosePct, aParams, pref, tAmb, fridgeT, staglioH, targetTotalH: hoursUntilBake, warmupH: warmupHPlanner, rampAdu: rampAduPlanner });
    } catch { return []; }
  }, [solverW, agentType, dosePct, aParams, pref, tAmb, fridgeT, staglioH, hoursUntilBake, warmupHPlanner, rampAduPlanner]);

  // Un solo protocollo consigliato (CTA brace); gli altri sono alternative.
  const recommendedPlan = useMemo(() => pickRecommended(results), [results]);
  const dateInPast = !!targetDate && hoursUntilBake === undefined;
  // Senza un orario il piano è solo indicativo: niente avvio finché non si sceglie quando infornare.
  const dateMissing = !targetDate;
  const bakeBlocked = dateMissing || dateInPast || plannerErrors.length > 0;
  const bakeBlockedReason = dateMissing ? 'Scegli giorno e ora della cottura: il piano si costruisce su quell\'orario.'
    : dateInPast ? "L'orario di cottura scelto è già passato: scegline uno futuro."
    : plannerErrors.length > 0 ? plannerErrors[0] : undefined;

  // Lancia wizard con i parametri del protocollo scelto → direttamente al riepilogo (step 8)
  const useResult = (r: PlanResult) => {
    // FlourGroup sintetico dal W selezionato nel planner (blend o singolo)
    const selectedEntry = FLOUR_DATABASE.find(f => f.id === selectedFlourId);
    const flourArr = useBlend && blendFlours.length > 0
      ? blendFlours.map((bf, i) => ({
          name: `Farina ${i + 1}`, brand: '', W: bf.W, pl: flourPl, protein: flourProtein,
          ash: 0.55, percentage: bf.pct,
        }))
      : [{ name: selectedEntry?.name ?? 'Farina', brand: selectedEntry?.brand ?? '',
           W: solverW, pl: flourPl, protein: flourProtein, ash: selectedEntry?.ash ?? 0.55, percentage: 100 }];
    const mainFlourGroup = (normalizeFlourGroup as Function)(flourArr) as any;

    // Target cottura (opzionale)
    let targetBakeAt: Date | undefined;
    if (targetDate) {
      targetBakeAt = new Date(`${targetDate}T${targetTime}`);
    }

    // Transizione atomica: reset + patch + step 8 in un solo dispatch (evita flash Step1)
    dispatch({ type: 'WIZARD_RESET_WITH_PATCH', step: 8, patch: {
      style,
      protocol: 'direct' as const,
      mainFlourGroup,
      prefermenti: [],
      agentType,
      agentDosePct:     dosePct,
      apprettoProtocol: r.protocol,
      puntataH:         r.puntataH  ?? 8,
      staglioH:         r.staglioH,
      apprettoH:        r.protocol === 'tc_appreto' ? (r.warmupH ?? 0) : (r.apprettoH ?? 4),
      temperingH:       r.protocol === 'tc_appreto' ? (r.warmupH ?? 0) : undefined,
      // la soglia con cui il planner ha costruito i protocolli: la dashboard userà questa
      alertThreshold:   BAKE_TARGET_PCT,
      tcHours:          r.tcHours,
      fridgeTempC:      fridgeT,
      targetBakeAt,
      totalFlourGrams:  totalFlourG,
      hydration,
      salt,
      numPanetti,
      tLaboratorio:     tAmb,       // §2.7: T_lab al momento dell'impasto = T_amb planner
      kneadingMethod:   kneadingMethod,
      navigationSource: 'planner' as const,
    }});
    dispatch({ type: 'NAV', view: 'wizard' });
  };

  // ── Solver finestra di servizio (now-anchored) ──────────────────────────────
  const serviceStart = useMemo(() => {
    if (!serviceDate) return null;
    const d = new Date(`${serviceDate}T${serviceTime}`);
    return isNaN(d.getTime()) ? null : d;
  }, [serviceDate, serviceTime]);

  const serviceResult = useMemo<NowAnchoredAlarmResult | null>(() => {
    if (plannerMode !== 'service' || !serviceStart) return null;
    try {
      return (computeNowAnchoredAlarms as Function)({
        now: new Date(nowMs),
        serviceStart,
        serviceDurationH,
        ambientTempC: tAmb,
        fridgeTempC: fridgeT,
        agentType,
        agentEaKj: aParams.Ea,
        agentMuMax: aParams.muMax,
        agentLambda: aParams.lambda,
        agentDosePct: dosePct,
        W0: solverW,
        hydration,
        totalFlourGrams: totalFlourG,
        numPanetti,
        containerPreset: 'closed_box',
        prefermenti: [],
        initialMaturationOffset: 0,
        style,
        userTargetMaturationPct: userTargetMatPct ?? undefined,
        userBubbleThresholdPct: userBubbleThresholdPct ?? undefined,
        staglioH,
        salt,
        fridgeTempMin: 2,
      }) as NowAnchoredAlarmResult;
    } catch { return null; }
  }, [plannerMode, serviceStart, serviceDurationH, nowMs, tAmb, fridgeT, agentType, aParams, dosePct, solverW, hydration, totalFlourG, numPanetti, style, userTargetMatPct, userBubbleThresholdPct, staglioH, salt]);

  // Carica il piano servizio come sessione: timeline precomputata → wizard step 8
  const useServiceResult = (r: NowAnchoredAlarmResult) => {
    if (!r.feasible || !r.timeline || !serviceStart) return;
    const selectedEntry = FLOUR_DATABASE.find(f => f.id === selectedFlourId);
    const flourArr = [{
      name: selectedEntry?.name ?? 'Farina', brand: selectedEntry?.brand ?? '',
      W: solverW, pl: flourPl, protein: flourProtein, ash: selectedEntry?.ash ?? 0.55, percentage: 100,
    }];
    const mainFlourGroup = (normalizeFlourGroup as Function)(flourArr) as any;
    // L'obiettivo è l'INIZIO del servizio: lì l'impasto deve essere pronto. La
    // finestra (durata) viaggia a parte, così la dashboard la mostra.
    const targetBakeAt = new Date(serviceStart.getTime());
    const s = r.schedule!;

    dispatch({ type: 'WIZARD_RESET_WITH_PATCH', step: 8, patch: {
      style, protocol: 'direct' as const, mainFlourGroup, prefermenti: [],
      agentType,
      agentDosePct:     r.dose ?? dosePct,
      apprettoProtocol: 'tc_appreto',
      puntataH:         s.puntataH,
      staglioH:         s.staglioH,
      apprettoH:        s.serviceDurationH,   // finestra servizio come fase finale TA
      tcHours:          s.tcHours,
      fridgeTempC:      r.recommendedFridgeTempC ?? fridgeT,
      targetBakeAt,
      totalFlourGrams:  totalFlourG,
      hydration,
      salt,
      numPanetti,
      tLaboratorio:     tAmb,
      kneadingMethod,
      thermalTimeline:  r.timeline,           // onorata da startSession (no rebuild)
      temperingH:       s.temperingH,         // → marker USCITA FRIGO sulla dashboard
      bubbleThresholdPct: r.resolvedBubbleThresholdPct ?? 92,
      // "Pronto" all'inizio del servizio: soglia = maturazione prevista dal solver a
      // inizio finestra (il target del piano vale a fine servizio).
      alertThreshold:   Math.max(50, Math.min(100, Math.floor(r.atServiceStart?.maturationPct
        ?? r.resolvedTargetMaturationPct ?? userTargetMatPct ?? getStyleProfile(style).alertThreshold))),
      serviceWindowH:   serviceDurationH,
      navigationSource: 'planner' as const,
    }});
    dispatch({ type: 'NAV', view: 'wizard' });
  };

  // ── Solver Profilo Qualità ──────────────────────────────────────────────────
  const qualityResult = useMemo<QualityResult | null>(() => {
    if (plannerMode !== 'quality') return null;
    try {
      return solveQualityProfile(
        { extTarget, aromaTarget, sciTarget },
        { W, pl: flourPl },
        style,
        tAmb,
        fridgeT,
        staglioH,
      );
    } catch { return null; }
  }, [plannerMode, extTarget, aromaTarget, sciTarget, W, flourPl, style, tAmb, fridgeT, staglioH]);

  // Carica il piano qualità come sessione → wizard step 8
  const useQualityResult = (r: QualityResult) => {
    const selectedEntry = FLOUR_DATABASE.find(f => f.id === selectedFlourId);
    const flourArr = [{
      name: selectedEntry?.name ?? 'Farina', brand: selectedEntry?.brand ?? '',
      W, pl: flourPl, protein: flourProtein, ash: selectedEntry?.ash ?? 0.55, percentage: 100,
    }];
    const mainFlourGroup = (normalizeFlourGroup as Function)(flourArr) as any;
    const protocol = r.prefType !== 'none' ? ('single_pref' as const) : ('direct' as const);
    const prefHydration = r.prefType === 'biga' ? 48 : r.prefType === 'riporto' ? 65 : 100;
    const prefermenti = r.prefType !== 'none' ? [{
      id: `quality_${Date.now()}`, type: r.prefType, flourGroup: mainFlourGroup,
      flourFraction: r.prefFrac, hydration: prefHydration,
      tempC: r.prefTempC, durationH: r.prefDurH,
      yeastPct: r.prefType === 'riporto' ? undefined : r.prefYeastPct,
    }] : [];
    dispatch({ type: 'WIZARD_RESET_WITH_PATCH', step: 8, patch: {
      style, protocol, mainFlourGroup, prefermenti,
      agentType: r.agentType,
      agentDosePct: r.agentType === 'sourdough_wheat' ? 15 : 0.3,
      apprettoProtocol: r.apprettoProtocol,
      puntataH: r.puntataH,
      staglioH: r.staglioH,
      apprettoH: 0,   // il piano Qualità non ha appretto separato (totale = puntata + staglio + frigo)
      tcHours: r.tcHours,
      fridgeTempC: fridgeT,
      totalFlourGrams: totalFlourG,
      hydration: r.hydration,
      salt,
      numPanetti,
      tLaboratorio: tAmb,
      kneadingMethod,
      alertThreshold: Math.round(r.mTarget * 100),  // soglia allarme = maturazione target dal solver
      navigationSource: 'planner' as const,
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
          aria-label="Torna alla schermata iniziale"
          style={{ width: 44, height: 44, marginLeft: -12, background: 'none', border: 'none', color: 'var(--accent-brand)', fontFamily: 'var(--font-mono)', fontSize: 18, cursor: 'pointer' }}
        ><span aria-hidden="true">←</span></button>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--pm4-flour)', margin: 0 }}>
            Pianifica fermentazione
          </h1>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginTop: 2 }}>
            Scegli quando infornare: ti propongo il piano con gli orari
          </div>
        </div>
      </div>

      {/* ── Toggle modalità ── */}
      <SnapButtons
        label="Modalità"
        options={[
          { value: 'bake',    label: 'Orario',   desc: 'Pronta all\'orario che scegli' },
          { value: 'service', label: 'Servizio',  desc: 'Pronta per tutta la finestra di servizio' },
          { value: 'quality', label: 'Qualità',   desc: 'Raggiungi un profilo sensoriale target' },
        ]}
        value={plannerMode}
        onChange={v => setPlannerMode(v as 'bake' | 'service' | 'quality')}
      />

      {/* ── Target cottura ── */}
      {plannerMode === 'bake' && (
      <Card>
        <div style={{ ...S.label, marginBottom: 12 }}>Quando vuoi infornare?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
          <input
            type="date"
            aria-label="Giorno della cottura"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--pm4-line-strong)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem', outline: 'none', width: '100%',
            }}
          />
          <input
            type="time"
            aria-label="Ora della cottura"
            value={targetTime}
            onChange={e => setTargetTime(e.target.value)}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--pm4-line-strong)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem', outline: 'none', width: 120,
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
                → tra {fmtHours(hoursUntilBake)}
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
      )}

      {/* ── La risposta prima degli input: il piano consigliato con gli orari ── */}
      {plannerMode === 'bake' && recommendedPlan && (
        <PlanSummaryCard result={recommendedPlan} nowMs={nowMs} onUse={() => useResult(recommendedPlan)}
          disabled={bakeBlocked} disabledReason={bakeBlockedReason} />
      )}

      {/* Servizio e Qualità: obiettivo e risposta in alto, come in Orario;
          i parametri dell'impasto sotto li affinano. */}
      {/* ── Finestra di servizio (solo modalità service) ── */}
      {plannerMode === 'service' && (
        <Card>
          <div style={{ ...S.label, marginBottom: 12 }}>Finestra di servizio</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
            <input type="date" aria-label="Data del servizio" value={serviceDate} onChange={e => setServiceDate(e.target.value)}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--pm4-line-strong)',
                borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '0.9rem', outline: 'none', width: '100%' }} />
            <input type="time" aria-label="Ora di inizio del servizio" value={serviceTime} onChange={e => setServiceTime(e.target.value)}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--pm4-line-strong)',
                borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '0.9rem', outline: 'none', width: 120 }} />
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PlannerSlider label="Durata servizio" value={serviceDurationH} onChange={setServiceDurationH}
              min={0.5} max={8} step={0.5} unit="h" color="var(--accent-brand)" />
            <PlannerSlider
              label={`Soglia anti-bolle (lievitazione)${userBubbleThresholdPct == null ? ` · Profilo: ${getStyleProfile(style).bubbleThresholdPct}%` : ''}`}
              value={userBubbleThresholdPct ?? getStyleProfile(style).bubbleThresholdPct}
              onChange={(v) => setUserBubbleThresholdPct(v)}
              min={60} max={95} step={1} unit="%" color="var(--pm4-ember)" />
            {userBubbleThresholdPct != null && (
              <button
                onClick={() => setUserBubbleThresholdPct(null)}
                style={{ fontSize: 12, color: 'var(--pm4-ember-lo)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, padding: '0 4px', fontFamily: 'var(--font-mono)', alignSelf: 'flex-start' }}
              >
                Reset soglia bolle
              </button>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <label htmlFor="pm-plan-target-mat" style={{ ...S.label, display: 'block', marginBottom: 4 }}>
              Target maturazione (enzimatica)
              {userTargetMatPct == null && (
                <span style={{ color: 'var(--pm4-umber)', marginLeft: 6 }}>
                  Profilo {style}: {getStyleProfile(style).alertThreshold}%
                </span>
              )}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="pm-plan-target-mat"
                type="range" min={70} max={100} step={1}
                value={userTargetMatPct ?? getStyleProfile(style).alertThreshold}
                aria-valuetext={`${userTargetMatPct ?? getStyleProfile(style).alertThreshold}%`}
                onChange={e => setUserTargetMatPct(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, minWidth: 36 }}>
                {userTargetMatPct ?? getStyleProfile(style).alertThreshold}%
              </span>
              {userTargetMatPct != null && (
                <button
                  onClick={() => setUserTargetMatPct(null)}
                  style={{ fontSize: 12, color: 'var(--pm4-ember-lo)', background: 'none', border: 'none', cursor: 'pointer', minHeight: 44, padding: '0 4px', fontFamily: 'var(--font-mono)' }}
                >
                  Reset
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--pm4-umber)', margin: '4px 0 0', fontFamily: 'var(--font-mono)' }}>
              Abbassa per accettare maturazione parziale · Alza per spingere al massimo
            </p>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 10 }}>
            La finestra è a {tAmb}°C (palline fuori dal frigo). Target maturazione {userTargetMatPct ?? getStyleProfile(style).alertThreshold}% a fine servizio.
          </div>
        </Card>
      )}

      {plannerMode === 'service' && serviceResult && (
        <ServiceWindowResultCard result={serviceResult} serviceStart={serviceStart}
          serviceDurationH={serviceDurationH}
          bubbleThresholdPct={serviceResult.resolvedBubbleThresholdPct ?? 92}
          puntataKickoffH={SERVICE_WINDOW_DEFAULTS.puntataKickoffH}
          onUse={() => useServiceResult(serviceResult)}
          plannerErrors={plannerErrors} />
      )}

      {/* ── Profilo Qualità: target sliders ── */}
      {plannerMode === 'quality' && (
        <Card>
          <div style={{ ...S.label, marginBottom: 14 }}>Obiettivi sensoriali</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label htmlFor="pm-q-ext" style={S.label}>Estensibilità</label>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--pref-autolisi, #74b9ff)' }}>
                  {'●'.repeat(extTarget)}{'○'.repeat(5 - extTarget)}
                </span>
              </div>
              <input id="pm-q-ext" type="range" min={1} max={5} step={1} value={extTarget} aria-valuetext={`${extTarget} su 5`} onChange={e => setExtTarget(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--pref-autolisi, #74b9ff)' }} />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginTop: 3 }}>
                Rilascio del panetto · legato a maturazione + P/L + idratazione
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label htmlFor="pm-q-aroma" style={S.label}>Aromi</label>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-warning)' }}>
                  {'●'.repeat(aromaTarget)}{'○'.repeat(5 - aromaTarget)}
                </span>
              </div>
              <input id="pm-q-aroma" type="range" min={1} max={5} step={1} value={aromaTarget} aria-valuetext={`${aromaTarget} su 5`} onChange={e => setAromaTarget(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--accent-warning)' }} />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginTop: 3 }}>
                Maturazione + prefermenti (biga/poolish) + freddo prolungato
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label htmlFor="pm-q-sci" style={S.label}>Scioglievolezza</label>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--pm4-ember)' }}>
                  {'●'.repeat(sciTarget)}{'○'.repeat(5 - sciTarget)}
                </span>
              </div>
              <input id="pm-q-sci" type="range" min={1} max={5} step={1} value={sciTarget} aria-valuetext={`${sciTarget} su 5`} onChange={e => setSciTarget(+e.target.value)}
                style={{ width: '100%', accentColor: 'var(--pm4-ember)' }} />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', marginTop: 3 }}>
                Picco a 87% maturazione · idratazione + stile · non monotona
              </div>
            </div>
          </div>
        </Card>
      )}

      {plannerMode === 'quality' && qualityResult && (
        <QualityProfileResultCard result={qualityResult} onUse={() => useQualityResult(qualityResult)} plannerErrors={plannerErrors} />
      )}

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
            <PlannerSlider label="N° panetti" value={numPanetti} onChange={handleNumPanettiChange}
              min={1} max={130} step={1} color="var(--text-muted)" />
            <PlannerSlider label="Peso panetto" value={pesoPanetto} onChange={handlePesoPanettoChange}
              min={80} max={500} step={5} unit="g" color="var(--text-primary)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <PlannerSlider label="Farina totale" value={totalFlourG} onChange={handleFarinaChange}
                min={50} max={16_000} step={50} unit="g" color={farinaManuale ? 'var(--accent-warning)' : 'var(--text-primary)'} />
            </div>
            {farinaManuale && (
              <button onClick={resetFarinaCalcolata} style={{
                fontSize: 11, color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', paddingTop: 18, whiteSpace: 'nowrap',
              }}>
                Ricalcola
              </button>
            )}
          </div>
          {plannerMode !== 'quality' ? (
            <PlannerSlider label="Idratazione" value={hydration} onChange={setHydration}
              min={55} max={90} step={1} unit="%" color="var(--accent-info)" />
          ) : (
            <DerivedField
              label="Idratazione"
              value={qualityResult ? `${qualityResult.hydration}%` : '—'}
              explanation="derivato da Estensibilità"
            />
          )}
          <PlannerSlider label="Sale" value={salt} onChange={setSalt}
            min={0} max={4} step={0.1} unit="%" color="var(--accent-info)" />
          {/* Preview peso panetto calcolato */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Peso impasto stimato:{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              {Math.round(totalFlourG * (1 + hydration / 100 + salt / 100) / numPanetti)}g
            </strong>
            {' '}· farina totale:{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>{totalFlourG}g</strong>
          </div>
        </div>
      </Card>

      {/* ── Farina + Agente ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Selettore libreria farine */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...S.label }}>Farina</span>
            <select
              value={selectedFlourId}
              aria-label="Farina"
              onChange={e => {
                const id = e.target.value;
                setSelectedFlourId(id);
                const entry = FLOUR_DATABASE.find(f => f.id === id);
                if (entry && entry.id !== 'custom') {
                  setW(entry.W);
                  setFlourPl(entry.pl);
                  setFlourProtein(entry.protein);
                }
              }}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                color: selectedFlourId ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--pm4-line-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '7px 10px',
                minHeight: 44,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none' as const,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
                paddingRight: 28,
              }}
            >
              <option value="">📚 Libreria farine…</option>
              {getFlourBrands().map(brand => (
                <optgroup key={brand} label={brand}>
                  {getFloursByBrand(brand).map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} — W{f.W} · P/L {f.pl}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">✏️ Personalizzata</option>
            </select>
          </div>
          {/* Blend builder toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...S.label, flex: 1 }}>
              {useBlend ? 'Mix farine' : 'Forza farina (W)'}
            </span>
            <button
              onClick={() => setUseBlend(v => !v)}
              style={{
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: useBlend ? 'var(--accent-brand)' : 'var(--text-muted)',
                background: useBlend ? 'rgba(253,186,116,0.1)' : 'none',
                border: `1px solid ${useBlend ? 'rgba(253,186,116,0.3)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 8, padding: '6px 12px', minHeight: 44, cursor: 'pointer',
              }}
            >
              {useBlend ? '▼ Mix' : '+ Mix farine'}
            </button>
          </div>

          {!useBlend && (
            <PlannerSlider label="Forza farina (W)" value={W} onChange={setW}
              min={100} max={500} step={5} unit="W" color="var(--text-primary)" />
          )}

          {useBlend && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {blendFlours.map((fl, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                      Farina {i + 1} — W
                    </div>
                    <input type="number" min={100} max={500} step={5}
                      value={fl.W}
                      onChange={e => {
                        const next = [...blendFlours];
                        next[i] = { ...next[i], W: Math.max(100, Math.min(500, Number(e.target.value))) };
                        setBlendFlours(next);
                      }}
                      style={{
                        width: '100%', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                        border: '1px solid var(--pm4-line-strong)', borderRadius: 6,
                        padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 13,
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>%</div>
                    <input type="number" min={5} max={100} step={5}
                      value={fl.pct}
                      onChange={e => {
                        const next = [...blendFlours];
                        next[i] = { ...next[i], pct: Math.max(5, Math.min(100, Number(e.target.value))) };
                        setBlendFlours(next);
                      }}
                      style={{
                        width: '100%', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                        border: '1px solid var(--pm4-line-strong)', borderRadius: 6,
                        padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 13,
                      }}
                    />
                  </div>
                  <button
                    onClick={() => setBlendFlours(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                    aria-label={`Rimuovi farina ${i + 1} dal blend`}
                    style={{ fontSize: 14, color: 'var(--state-critical)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 2 }}
                  >×</button>
                </div>
              ))}
              {blendFlours.length < 3 && (
                <button
                  onClick={() => setBlendFlours(prev => [...prev, { W: 300, pct: 20 }])}
                  style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-brand)',
                    background: 'none', border: '1px dashed rgba(253,186,116,0.3)',
                    borderRadius: 6, padding: '5px 12px', cursor: 'pointer', width: '100%',
                  }}
                >
                  + aggiungi farina
                </button>
              )}
              {effectiveBlendW != null && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  W ponderato:{' '}
                  <strong style={{ color: 'var(--accent-brand)' }}>{effectiveBlendW}</strong>
                </div>
              )}
            </div>
          )}

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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -10 }}>
            {dosePct}% su {totalFlourG}g farina ={' '}
            <strong style={{ color: 'var(--accent-brand)' }}>
              {computeGrammiLievito(totalFlourG, dosePct, agentType)}
            </strong>
          </div>
          {/* issue #8 — la saturazione non deve piu' avvenire in silenzio */}
          {(doseFactorSaturated as Function)(effectiveDose, doseRef) && (
          <div role="status" style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.45,
            color: 'var(--accent-warning)', marginTop: 6,
          }}>
            Dose fuori dal dominio calibrato del modello: la previsione è saturata
            al limite e sara' ottimistica. Riferimento {doseRef ?? '—'}%.
          </div>
          )}
        </div>
      </Card>

      {/* ── Temperature + Staglio + Impastatrice ── */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PlannerSlider label="Temperatura ambiente" value={tAmb} onChange={setTAmb}
            min={10} max={38} step={0.5} unit="°C" />
          <PlannerSlider label="Temperatura frigo (TC)" value={fridgeT} onChange={setFridgeT}
            min={1} max={8} step={0.5} unit="°C" color="var(--state-cold)" />
          <PlannerSlider label="Staglio" value={staglioH} onChange={setStaglioH}
            min={0.1} max={2} step={0.1} unit="h" color="var(--text-muted)" />
          <SnapButtons<KneadingMethod>
            label="Impastatrice"
            options={Object.entries(KNEADING_METHODS_FRICTION).map(([k, v]) => ({
              value: k as KneadingMethod,
              label: v.label,
            }))}
            value={kneadingMethod}
            onChange={setKneadingMethod}
          />
          {(() => {
            const doughMassKg = (totalFlourG * (1 + hydration / 100)) / 1000;
            const fRise = (computeFrictionRise as Function)(kneadingMethod, 12, hydration, doughMassKg) as number;
            return (
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                C_attrito ≈ {fRise.toFixed(1)}°C (12 min, unificato)
                · {KNEADING_METHODS_FRICTION[kneadingMethod].notes}
              </div>
            );
          })()}
        </div>
      </Card>

      {/* ── Risultati ── */}
      {plannerMode === 'bake' && (
      <div>
        <h2 style={{ ...S.label, margin: '0 0 12px', fontWeight: 400 }}>
          {recommendedPlan ? 'Alternative' : 'Protocolli'} a {tAmb}°C ambiente / {fridgeT}°C frigo
        </h2>
        {results.length === 0 ? (
          <Card style={{ textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            Inserisci i parametri sopra per vedere i suggerimenti
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {results.map(r => (
              <ProtocolCard
                key={r.protocol}
                recommended={r === recommendedPlan}
                disabled={bakeBlocked}
                result={r}
                aParams={aParams}
                agentType={agentType}
                tAmb={tAmb}
                fridgeT={fridgeT}
                initialAdu={initialAdu}
                muMax={muMax}
                onUse={() => useResult(r)}
                plannerErrors={plannerErrors}
              />
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Opzioni avanzate: acqua di impasto e dettagli tecnici, chiuse di default ── */}
      <details className="pm4-panel" style={{ padding: 0 }}>
        <summary style={{ minHeight: 44, padding: '13px 14px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--pm4-tan)' }}>
          Dettagli: acqua di impasto e velocità del lievito
        </summary>
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Acqua di impastamento (DDT live) ── */}
      {(plannerMode === 'quality' ? qualityResult !== null : results.length > 0) && (() => {
        const waterG      = Math.round(totalFlourG * (hydration / 100));
        const ddtDef      = ddtForStyle(style);
        const doughMassKg = (totalFlourG * (1 + hydration / 100)) / 1000;
        const wResult     = (computeWaterTempDDT as Function)({
          ddtTarget:       ddtDef,
          tempAmbient:     tAmb,
          kneadingMethod,
          waterTotalGrams: waterG,
          tempPreferment:  undefined,
          kneadDurationMin: 12,
          hydrationEff:    hydration,
          doughMassKg,
        });
        return (
          <Card>
            <div style={{ marginBottom: 10, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
              💧 Acqua di impastamento
            </div>
            <WaterTempResultCard
              result={wResult}
              showFormula={true}
              ddtTarget={ddtDef}
              tAmbient={tAmb}
            />
          </Card>
        );
      })()}

      {/* ── Dettaglio tecnico, secondario ── */}
      <Metric label="Velocità del lievito rispetto a 25°C (ambiente / frigo)" value={`${((kEffective as Function)(tAmb, aParams.Ea, agentType) as number / (kEffective as Function)(25, aParams.Ea, agentType) as number).toFixed(3)} / ${((kEffective as Function)(fridgeT, aParams.Ea, agentType) as number / (kEffective as Function)(25, aParams.Ea, agentType) as number).toFixed(4)}`} />
        </div>
      </details>
    </div>
  );
}
