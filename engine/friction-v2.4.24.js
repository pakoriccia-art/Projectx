/**
 * PizzaMatrix — Modello Attrito Meccanico Unificato (v2.4.24, §2.7)
 *
 * SORGENTE UNICA DI VERITÀ per il calore di attrito meccanico, condivisa tra:
 *   • §2.7 — salita fisica di temperatura dell'impasto (°C sopra la media-N)
 *   • wizard DDT — conversione in unità-formula (C_attrito = N × ΔT)
 *
 * Sostituisce il C_attrito fisso (KNEADING_METHODS_FRICTION lo/mid/hi) con un
 * modello duration-aware, mixer-aware e consistency-aware. La generalità è
 * strutturale: l'attrito dipende da consistenza fisica + mixer + tempo, NON
 * dall'etichetta `style`. Lo stile entra SOLO via idratazione/prefermenti.
 *
 * Two-Clock invariante: questo modulo NON legge né scrive enzAdu/leavAdu/labAdu.
 * Alimenta solo la raccomandazione acqua/ghiaccio del wizard e il display di
 * uscita prevista. simulateTimeline, tick loop e plannerAlarmEngine: invariati.
 */

// ─── FRICTION_PARAMS — costanti centralizzate (Appendix C) ───────────────────
// validationStatus:'hypothesis' salvo dove indicato. baseRatePer10min eredita §2.7.
export const FRICTION_PARAMS = {
  baseRatePer10min: {          // °C/10min @ 1kg, 65% idr — eredita §2.7
    spiral: 3.8, fork: 2.5, planetary: 7.5, diving_arm: 3.2, hand: 1.2,
  },
  hydrationRef: 65,
  kHydration: 0.0075,          // °C per punto % di scostamento da 65 — hypothesis
  hydClamp: [0.80, 1.30],
  massRefKg: 1.0,
  massExponent: 0.15,          // ΔT ∝ massKg^0.15 — debole, hypothesis
  massClamp: [0.85, 1.35],
  frictionCalib: {             // unica incognita empirica per mixer
    spiral: null,              // → fitFrictionCalib('spiral') dagli anchor
    fork: 1.0, planetary: 1.0, diving_arm: 1.0, hand: 1.0, // non calibrati — hypothesis
  },
  exitWarnC: 27,               // uscita > soglia → warning glutine slegato
  minLiquidWaterC: 4,          // acqua richiesta < soglia → ramo ghiaccio
  defaultTapWaterC: 15,        // se non disponibile dal wizard
};

// Anchor di calibrazione misurati. Array estendibile dall'harness senza toccare il codice.
export const FRICTION_CALIBRATION_ANCHORS = [
  {
    id: 'pasquale_biga_contemporanea_2026',
    mixer: 'spiral',
    durationMin: 14,
    nFactors: 4,
    ingredientTempsC: { ambient: 24, flour: 24, water: 24, prefermento: 17 },
    measuredDoughTempC: 32,
    hydrationEff: 70,   // TODO confermare idratazione finale reale della sessione
    massKg: 1.0,        // TODO confermare pezzatura reale (totale impasto kg)
    validationStatus: 'measured',
  },
];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Salita strutturale SENZA calibrazione [°C sopra la media-N] — per fit e debug.
 * ΔT = baseRate × (durataMin/10) × f_hyd(H_eff) × f_mass(massKg)
 */
export function frictionRiseStructural(mixer, durationMin, hydrationEff, massKg) {
  const P = FRICTION_PARAMS;
  const base = P.baseRatePer10min[mixer] ?? P.baseRatePer10min.spiral;
  const fHyd = clamp(1 + P.kHydration * (P.hydrationRef - hydrationEff), P.hydClamp[0], P.hydClamp[1]);
  const fMass = clamp(Math.pow((massKg || 1) / P.massRefKg, P.massExponent), P.massClamp[0], P.massClamp[1]);
  return base * (Math.max(0, durationMin) / 10) * fHyd * fMass;
}

/**
 * Fit della calibrazione per-mixer dagli anchor misurati (media dei rapporti
 * ΔT_measured / ΔT_struct). Con un solo anchor il fit è un punto.
 */
export function fitFrictionCalib(mixer) {
  const anchors = FRICTION_CALIBRATION_ANCHORS.filter(a => a.mixer === mixer);
  if (!anchors.length) return 1.0;
  const ratios = anchors.map(a => {
    const t = a.ingredientTempsC;
    const sum = t.ambient + t.flour + t.water + (t.prefermento ?? 0);
    const avgN = sum / a.nFactors;
    const dTmeasured = a.measuredDoughTempC - avgN;
    const dTstruct = frictionRiseStructural(mixer, a.durationMin, a.hydrationEff, a.massKg);
    return dTstruct > 0 ? dTmeasured / dTstruct : 1.0;
  });
  return ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

/**
 * SORGENTE UNICA DI VERITÀ — salita reale (calibrata) [°C sopra la media-N].
 * `frictionCalib[mixer]` esplicito vince; se null → fit dagli anchor.
 */
export function computeFrictionRise(mixer, durationMin, hydrationEff, massKg) {
  const explicit = FRICTION_PARAMS.frictionCalib[mixer];
  const calib = (explicit == null) ? fitFrictionCalib(mixer) : explicit;
  return frictionRiseStructural(mixer, durationMin, hydrationEff, massKg) * calib;
}

/**
 * Idratazione efficace di impastamento [% ] — generalità tra metodi.
 * H_eff = Σ(frac_i × H_pref_i) + frac_rinfresco × H_finale.
 * Diretto (nessun prefermento) → H_eff = H_finale. Biga rigida abbassa H_eff
 * (più attrito); poolish idratato lo alza (meno attrito).
 */
export function computeEffectiveMixHydration(session) {
  const Hfinal = session.hydration;
  const prefs = session.prefermenti ?? [];
  if (!prefs.length) return Hfinal;
  let accFrac = 0, accH = 0;
  for (const p of prefs) {
    const frac = (p.flourFraction ?? 0) / 100;
    accFrac += frac;
    accH += frac * (p.hydration ?? Hfinal);
  }
  return accH + Math.max(0, 1 - accFrac) * Hfinal;
}

/**
 * Predizione T uscita impasto [°C] dato il setpoint acqua EFFETTIVO.
 * avgNeffective = media-N usando l'acqua effettiva (ghiaccio già contabilizzato
 * a monte). T_uscita = media-N + ΔT_attrito.
 */
export function predictDoughExitTemp(avgNeffective, mixer, durationMin, hydrationEff, massKg) {
  return avgNeffective + computeFrictionRise(mixer, durationMin, hydrationEff, massKg);
}
