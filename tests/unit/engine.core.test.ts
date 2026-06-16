// tests/unit/engine.core.test.ts
// 50 test — fArrhenius, kEffective, Gompertz, sale, Two-Clock, W-decay, blend, style, collasso, pH
import { describe, it, expect } from 'vitest';
import {
  fArrhenius, kEffective, gompertz, findAduAt,
  computeWHill, computeTCrit, structuralState, maxSafeHydration,
  fSaltYeast, fSaltProtease,
  normalizeFlourGroup, blendAmylaseIndex, validateFlourGroup,
  normalizeAmylaseActivity,
  getStyleProfile, computeStyleAwareAlertLevel,
  computeCurrentPH,
  AGENT_GOMPERTZ,
} from '../../engine/engine-v2.4.0.js';
import { simulateTimeline } from '../../engine/serviceWindowSolver.js';

// Opts base per simulateTimeline — richiede agentEaKj, muMaxScaled, leavLambda
const lbf = (AGENT_GOMPERTZ as any).fresh_yeast;
const sourdough = (AGENT_GOMPERTZ as any).sourdough_wheat;
const mkOpts = (agentType: string, salt = 0, W0 = 280) => {
  const ag = (AGENT_GOMPERTZ as any)[agentType] ?? lbf;
  return {
    agentType, agentEaKj: ag.Ea, muMaxScaled: ag.muMax,
    leavLambda: ag.lambda, agentAsymptote: ag.asymptote ?? 100,
    salt, W0, hydration: 65,
  };
};

// ─── 1.A fArrhenius: orologio enzimatico (Ea = 47 kJ/mol) ───────────────────

describe('fArrhenius — clock enzimatico (Ea=47)', () => {
  it('UT-ENG-01: valore unitario a T_ref=25°C (298.15K)', () => {
    expect(fArrhenius(25)).toBeCloseTo(1.0, 4);
  });

  it('UT-ENG-02: valore > 1 a T > 25°C (catalisi accelerata)', () => {
    expect(fArrhenius(35)).toBeGreaterThan(1.0);
  });

  it('UT-ENG-03: valore < 1 a T < 25°C (rallentamento)', () => {
    expect(fArrhenius(4)).toBeLessThan(1.0);
  });

  it('UT-ENG-04: ratio fArrhenius(35)/fArrhenius(25) compatibile con Q10≈2 per Ea=47', () => {
    const ratio = fArrhenius(35) / fArrhenius(25);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it('UT-ENG-05: fArrhenius non restituisce NaN né Infinity per T in [-5, 60]', () => {
    for (const t of [-5, 0, 4, 10, 20, 25, 30, 37, 45, 60]) {
      const v = fArrhenius(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('UT-ENG-06: fArrhenius(4°C) ∈ (0.15, 0.35) (frigo standard)', () => {
    const v = fArrhenius(4);
    expect(v).toBeGreaterThan(0.15);
    expect(v).toBeLessThan(0.35);
  });
});

// ─── 1.B kEffective: clock lievito CTM×Arrhenius ─────────────────────────────

describe('kEffective — clock lievito (CTM×Arrhenius)', () => {
  // Ea for fresh_yeast leavAdu = AGENT_GOMPERTZ.fresh_yeast.Ea = 62
  const EA_FRESH = (AGENT_GOMPERTZ as any).fresh_yeast.Ea as number; // 62

  it('UT-ENG-07: a T_opt=28°C fresh_yeast, kEffective > fArrhenius (CTM boosta)', () => {
    expect(kEffective(28, EA_FRESH, 'fresh_yeast')).toBeGreaterThan(fArrhenius(28));
  });

  it('UT-ENG-08: kEffective=0 a T≤Tmin (1.5°C per fresh_yeast)', () => {
    expect(kEffective(1.0, EA_FRESH, 'fresh_yeast')).toBe(0);
  });

  it('UT-ENG-09: kEffective=0 a T≥Tmax (45°C per fresh_yeast)', () => {
    expect(kEffective(46, EA_FRESH, 'fresh_yeast')).toBe(0);
  });

  it('UT-ENG-10: fresh_yeast ha kEffective > sourdough_wheat a 32°C (T_opt fresh yeast)', () => {
    const EA_SOUR = (AGENT_GOMPERTZ as any).sourdough_wheat.Ea as number;
    const kSour  = kEffective(32, EA_SOUR, 'sourdough_wheat');
    const kFresh = kEffective(32, EA_FRESH, 'fresh_yeast');
    expect(kFresh).toBeGreaterThan(kSour);
  });

  it('UT-ENG-11: kEffective non NaN per tutti i tipi agente in [2, 44]°C', () => {
    const agents: Array<[string, number]> = [
      ['fresh_yeast', EA_FRESH],
      ['instant_dry_yeast', (AGENT_GOMPERTZ as any).instant_dry_yeast.Ea],
      ['sourdough_wheat',   (AGENT_GOMPERTZ as any).sourdough_wheat.Ea],
    ];
    for (const [a, ea] of agents) {
      for (const t of [2, 10, 20, 28, 35, 44]) {
        expect(Number.isFinite(kEffective(t, ea, a))).toBe(true);
      }
    }
  });

  it('UT-ENG-12: kEffective(4°C, instant_dry_yeast) < 0.15 (quasi fermo in frigo)', () => {
    const EA_IDY = (AGENT_GOMPERTZ as any).instant_dry_yeast.Ea as number;
    expect(kEffective(4, EA_IDY, 'instant_dry_yeast')).toBeLessThan(0.15);
  });
});

// ─── 1.C Gompertz e findAduAt ─────────────────────────────────────────────────

describe('gompertz e findAduAt — curva maturazione', () => {
  it('UT-ENG-13: gompertz(ADU=0) basso ma > 0 (fase lag iniziale)', () => {
    const v = gompertz(0, 4.20, 0.50, 100);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(10);
  });

  it('UT-ENG-14: gompertz scala asintoticamente verso A=100 per ADU molto grande', () => {
    expect(gompertz(50, 4.20, 0.50, 100)).toBeGreaterThan(95);
  });

  it('UT-ENG-15: gompertz è monotona crescente in ADU', () => {
    let prev = gompertz(0, 4.20, 0.50, 100);
    for (const adu of [0.5, 1, 2, 3, 5, 8, 12, 20]) {
      const curr = gompertz(adu, 4.20, 0.50, 100);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('UT-ENG-16: findAduAt(muMax, lambda, A, 50) restituisce ADU tale che gompertz(ADU)≈50', () => {
    const adu = findAduAt(4.20, 0.50, 100, 50);
    expect(gompertz(adu, 4.20, 0.50, 100)).toBeCloseTo(50, 1);
  });

  it('UT-ENG-17: ENZYMATIC_CLOCK — gompertz(9.50, muMax=9.50, lambda=0.50) > 50% e < 100%', () => {
    const v = gompertz(9.50, 9.50, 0.50, 100);
    expect(v).toBeGreaterThan(50);
    expect(v).toBeLessThan(100);
  });

  it('UT-ENG-18: gompertz con parametri sourdough più lento di fresh_yeast a parità di ADU basso', () => {
    const adu = 1.5;
    const yeast = gompertz(adu, 4.20, 0.50, 100);
    const sour  = gompertz(adu, 2.80, 1.20, 100);
    expect(sour).toBeLessThan(yeast);
  });
});

// ─── 1.D fSaltYeast e fSaltProtease ──────────────────────────────────────────

describe('fSaltYeast e fSaltProtease — effetto sale', () => {
  it('UT-ENG-19: fSaltYeast(0) = 1.0 (nessun sale = nessuna inibizione)', () => {
    expect(fSaltYeast(0)).toBeCloseTo(1.0, 4);
  });

  it('UT-ENG-20: fSaltYeast(2%) = 0.80 (inibizione tipica pizza)', () => {
    expect(fSaltYeast(2)).toBeCloseTo(0.80, 2);
  });

  it('UT-ENG-21: fSaltYeast floor ≥ 0.60 (non va sotto anche ad alto sale)', () => {
    expect(fSaltYeast(10)).toBeGreaterThanOrEqual(0.60);
    expect(fSaltYeast(10)).toBeLessThanOrEqual(0.65);
  });

  it('UT-ENG-22: fSaltProtease(0) = 1.0', () => {
    expect(fSaltProtease(0)).toBeCloseTo(1.0, 4);
  });

  it('UT-ENG-23: fSaltProtease(2%) ≈ 0.84 (floor=0.70, kSalt=0.08)', () => {
    expect(fSaltProtease(2)).toBeCloseTo(0.84, 2);
  });

  it('UT-ENG-24: fSaltProtease floor ≥ 0.70', () => {
    expect(fSaltProtease(15)).toBeGreaterThanOrEqual(0.70);
  });
});

// ─── 1.E Two-Clock Invariant nel tick ────────────────────────────────────────

describe('Two-Clock Invariant — separazione enzAdu/leavAdu', () => {
  const mkBase = (tempC: number) => ({
    tempDough: tempC, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
    leaveningPct: 0, wDamage: 0, W_current: 280, structuralState: 'OK', elapsedH: 0,
  });

  it('UT-ENG-25: simulateTimeline — enzAdu ≈ fArrhenius(25)×2 dopo 2h a 25°C', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 2, ambientTempC: 25, startElapsedH: 0 }];
    const { final } = simulateTimeline(segs, mkBase(25), mkOpts('fresh_yeast', 0));
    expect(final.enzAdu).toBeCloseTo(2.0, 0);
  });

  it('UT-ENG-26: sale=2% riduce leavAdu ma NON modifica enzAdu', () => {
    const seg = [{ phaseType: 'bulk_room', durationH: 4, ambientTempC: 25, startElapsedH: 0 }];
    const noSalt   = simulateTimeline(seg, mkBase(25), mkOpts('fresh_yeast', 0));
    const withSalt = simulateTimeline(seg, mkBase(25), mkOpts('fresh_yeast', 2));
    expect(withSalt.final.enzAdu).toBeCloseTo(noSalt.final.enzAdu, 2);
    expect(withSalt.final.leavAdu).toBeLessThan(noSalt.final.leavAdu);
  });

  it('UT-ENG-27: enzAdu non dipende dall\'agente lievitante (solo T)', () => {
    const seg = [{ phaseType: 'bulk_room', durationH: 3, ambientTempC: 20, startElapsedH: 0 }];
    const r1 = simulateTimeline(seg, mkBase(20), mkOpts('fresh_yeast',   2));
    const r2 = simulateTimeline(seg, mkBase(20), mkOpts('sourdough_wheat', 2));
    expect(r1.final.enzAdu).toBeCloseTo(r2.final.enzAdu, 2);
  });

  it('UT-ENG-28: enzAdu ≥ leavAdu a T frigo con sourdough (Ea_enz<Ea_leav)', () => {
    const seg  = [{ phaseType: 'balled_fridge', durationH: 24, ambientTempC: 4, startElapsedH: 0 }];
    const base = { ...mkBase(4), W_current: 300 };
    const r = simulateTimeline(seg, base, mkOpts('sourdough_wheat', 2.5, 300));
    expect(r.final.enzAdu).toBeGreaterThanOrEqual(r.final.leavAdu);
  });
});

// ─── 1.F W-decay: Hill + computeTCrit + structuralState ──────────────────────

describe('W-decay — Hill + tCrit + structuralState', () => {
  it('UT-ENG-29: computeWHill(W0=280, tCrit=24, hours=0) = W0 (nessun decay iniziale)', () => {
    expect(computeWHill(280, 24, 0, 5)).toBeCloseTo(280, 0);
  });

  it('UT-ENG-30: computeWHill(280, 24, tCrit=24) < W0 (decadimento attivo)', () => {
    const v = computeWHill(280, 24, 24, 5);
    expect(v).toBeLessThan(280);
    expect(v).toBeGreaterThan(100);
  });

  it('UT-ENG-31: W-decay monotona decrescente nel tempo', () => {
    let prev = 280;
    for (const h of [1, 4, 8, 16, 24, 48]) {
      const curr = computeWHill(280, 24, h, 5);
      expect(curr).toBeLessThanOrEqual(prev);
      prev = curr;
    }
  });

  it('UT-ENG-32: fSaltProtease(2%) < 1 → t_crit effettivo più lungo con sale', () => {
    // fSaltProtease riduce la velocità proteolitica → t_crit / fSaltProtease > t_crit
    const tCritBase    = computeTCrit(280, 25, 5.5, 65);
    const saltFactor   = fSaltProtease(2);
    const tCritSalted  = tCritBase / saltFactor;
    expect(tCritSalted).toBeGreaterThan(tCritBase);
  });

  it('UT-ENG-33: structuralState("OK") se W_current molto vicino a W0', () => {
    const s = structuralState(280, 275, 65, 0.55, 12.5);
    expect(s).toBe('OK');
  });

  it('UT-ENG-34: structuralState CRITICAL/COLLAPSED per W_current < 160 (napoletana)', () => {
    const s = structuralState(280, 150, 65, 0.55, 12.5);
    expect(['WARNING', 'CRITICAL', 'COLLAPSED']).toContain(s);
  });

  it('UT-ENG-35: maxSafeHydration decresce al diminuire di W_current', () => {
    const h1 = maxSafeHydration(280, 0.55, 12.5);
    const h2 = maxSafeHydration(200, 0.55, 12.5);
    expect(h2).toBeLessThan(h1);
  });
});

// ─── 1.G Blend farine ────────────────────────────────────────────────────────

describe('normalizeFlourGroup e blendAmylaseIndex', () => {
  it('UT-ENG-36: normalizeFlourGroup con singola farina: effectiveW = W farina', () => {
    const fg = normalizeFlourGroup([{ name: 'Test', brand: 'X', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }]);
    expect(fg.effectiveW).toBeCloseTo(280, 0);
  });

  it('UT-ENG-37: normalizeFlourGroup con blend 50/50: effectiveW tra i due W e isBlend=true', () => {
    const fg = normalizeFlourGroup([
      { name: 'A', brand: 'X', W: 200, pl: 0.4, protein: 11, percentage: 50 },
      { name: 'B', brand: 'Y', W: 380, pl: 0.6, protein: 14, percentage: 50 },
    ]);
    expect(fg.effectiveW).toBeGreaterThan(200);
    expect(fg.effectiveW).toBeLessThan(380);
    expect(fg.isBlend).toBe(true);
  });

  it('UT-ENG-38: validateFlourGroup ritorna errore se somma percentuali ≠ 100', () => {
    const result = validateFlourGroup([
      { name: 'A', brand: 'X', W: 280, pl: 0.55, protein: 12.5, percentage: 60 },
      { name: 'B', brand: 'Y', W: 300, pl: 0.5,  protein: 13,   percentage: 30 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('UT-ENG-39: effectiveAsh sempre popolato (mai undefined)', () => {
    const fg = normalizeFlourGroup([{ name: 'X', brand: 'B', W: 280, pl: 0.55, protein: 12, percentage: 100 }]);
    expect(fg.effectiveAsh).toBeDefined();
    expect(fg.effectiveAsh).toBeGreaterThan(0);
  });

  it('UT-ENG-40: blendAmylaseIndex con FN basso > FN alto (FN basso = attività amilasi alta)', () => {
    const highFN = [{ FN: 500, percentage: 100, W: 280, pl: 0.55, protein: 12, name: 'X', brand: 'B' }];
    const lowFN  = [{ FN: 200, percentage: 100, W: 280, pl: 0.55, protein: 12, name: 'Y', brand: 'B' }];
    expect(blendAmylaseIndex(lowFN)).toBeGreaterThan(blendAmylaseIndex(highFN));
  });
});

// ─── 1.H Style Profiles + Alert ──────────────────────────────────────────────

describe('getStyleProfile e computeStyleAwareAlertLevel', () => {
  it('UT-ENG-41: getStyleProfile ritorna profilo valido per tutti i 5 stili', () => {
    const styles = ['napoletana', 'contemporanea', 'teglia', 'pala', 'nystyle'];
    for (const s of styles) {
      const p = getStyleProfile(s);
      expect(p).toBeDefined();
      expect(p.alertThreshold).toBeGreaterThan(0);
      expect(p.bubbleThresholdPct).toBeGreaterThan(0);
    }
  });

  it('UT-ENG-42: napoletana ha bubbleThresholdPct più basso di teglia (forno legna intollerante)', () => {
    expect(getStyleProfile('napoletana').bubbleThresholdPct)
      .toBeLessThan(getStyleProfile('teglia').bubbleThresholdPct);
  });

  it('UT-ENG-43: alert level definito quando matPct > alertThreshold', () => {
    const profile = getStyleProfile('napoletana');
    const result = computeStyleAwareAlertLevel(
      { style: 'napoletana', hydration: 65, salt: 2 },
      profile.alertThreshold + 5,
      200, 280, 80,
    );
    // computeStyleAwareAlertLevel restituisce { level, bindingSignal, message }
    expect(result.level).toBeDefined();
    expect(['OK', 'APPROACHING', 'SWEET_SPOT', 'STRUCTURAL_WARNING', 'STRUCTURAL_CRITICAL', 'STRUCTURAL_COLLAPSED'])
      .toContain(result.level);
  });

  it('UT-ENG-44: puntataH_range_ta contemporanea[1] ≤ napoletana[1]', () => {
    const napo = getStyleProfile('napoletana');
    const cont = getStyleProfile('contemporanea');
    expect(cont.puntataH_range_ta[1]).toBeLessThanOrEqual(napo.puntataH_range_ta[1]);
  });

  it('UT-ENG-45: W_minimo_stesura per nystyle = 220', () => {
    const p = getStyleProfile('nystyle');
    expect(p.W_minimo_stesura).toBe(220);
  });
});

// ─── 1.I Collasso strutturale + pH ───────────────────────────────────────────

describe('Collasso strutturale e computeCurrentPH', () => {
  const mkBase = (tempC: number, W: number) => ({
    tempDough: tempC, enzAdu: 0, leavAdu: 0, enzymaticMatPct: 0,
    leaveningPct: 0, wDamage: 0, W_current: W, structuralState: 'OK', elapsedH: 0,
  });

  it('UT-ENG-46: simulateTimeline lunga a TA alta → W_current degrada (struttura indebolita)', () => {
    const segs = [{ phaseType: 'bulk_room', durationH: 72, ambientTempC: 28, startElapsedH: 0 }];
    const { final } = simulateTimeline(segs, mkBase(28, 220), mkOpts('fresh_yeast', 2, 220));
    // W decay progressivo → W_current < W0
    expect(final.W_current).toBeLessThan(220);
  });

  it('UT-ENG-47: computeCurrentPH scende al crescere di leavAdu (acidificazione)', () => {
    const ph0 = computeCurrentPH(6.0, 0, 'fresh_yeast', 0);
    const ph1 = computeCurrentPH(6.0, 5, 'fresh_yeast', 0);
    const ph2 = computeCurrentPH(6.0, 15, 'fresh_yeast', 0);
    expect(ph1).toBeLessThan(ph0);
    expect(ph2).toBeLessThan(ph1);
  });

  it('UT-ENG-48: computeCurrentPH firma: (initialPH, leavAdu, agentType, labAdu) — enzAdu non in firma', () => {
    const ph = computeCurrentPH(6.0, 3, 'fresh_yeast', 0);
    expect(Number.isFinite(ph)).toBe(true);
    expect(ph).toBeGreaterThan(4.0);
    expect(ph).toBeLessThan(7.0);
  });

  it('UT-ENG-49: normalizeAmylaseActivity(250) = 1.0 (FN di riferimento DEFAULT_FN)', () => {
    expect(normalizeAmylaseActivity(250)).toBeCloseTo(1.0, 4);
  });

  it('UT-ENG-50: normalizeAmylaseActivity(200) > 1.0 (FN basso = attività amilasi alta)', () => {
    expect(normalizeAmylaseActivity(200)).toBeGreaterThan(1.0);
  });
});
