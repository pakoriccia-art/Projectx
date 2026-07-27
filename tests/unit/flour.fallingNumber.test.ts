// tests/unit/flour.fallingNumber.test.ts
// Falling Number: dato mancante reso esplicito — issue #7.
//
// Nessuna farina del catalogo dichiara FN, quindi il motore cade su
// DEFAULT_FALLING_NUMBER per tutte e normalizeAmylaseActivity restituisce
// sempre 0.507: l'intero sottosistema amilasico non discrimina mai fra farine.
//
// Questi test verificano due cose distinte:
//   1. il MECCANISMO funziona (FN diversi -> curve diverse) — verde oggi
//   2. il DATO manca ancora — `it.todo`, resta pendente finché il catalogo
//      non viene popolato da schede tecniche verificate
import { describe, it, expect } from 'vitest';
import {
  FLOUR_DATABASE, DEFAULT_FALLING_NUMBER,
  resolveFallingNumber, fallingNumberCoverage,
} from '../../src/data/flourDatabase';
import {
  normalizeAmylaseActivity, amylaseCorrectedRate, gompertz, blendAmylaseIndex,
} from '../../engine/engine-v2.4.0.js';

describe('resolveFallingNumber — assenza esplicita, non default silenzioso', () => {
  it('UT-FN-01: FN dichiarato → measured=true e valore invariato', () => {
    const r = resolveFallingNumber({ FN: 260 });
    expect(r).toEqual({ fn: 260, measured: true });
  });

  it('UT-FN-02: FN assente → measured=false e fallback dichiarato', () => {
    const r = resolveFallingNumber({});
    expect(r).toEqual({ fn: DEFAULT_FALLING_NUMBER, measured: false });
  });

  it('UT-FN-03: flour undefined non crasha', () => {
    expect(resolveFallingNumber(undefined).measured).toBe(false);
  });

  it('UT-FN-04: FN non finito (NaN/Infinity) è trattato come assente', () => {
    expect(resolveFallingNumber({ FN: NaN }).measured).toBe(false);
    expect(resolveFallingNumber({ FN: Infinity }).measured).toBe(false);
  });
});

describe('il meccanismo amilasico discrimina davvero fra farine', () => {
  // FN basso = molta alfa-amilasi = molto substrato = fermentazione più veloce.
  const FN_ALTA_ATTIVITA = 220;
  const FN_BASSA_ATTIVITA = 400;

  it('UT-FN-05: FN diversi producono amylaseIndex diversi e ordinati', () => {
    const alta  = normalizeAmylaseActivity(FN_ALTA_ATTIVITA);
    const bassa = normalizeAmylaseActivity(FN_BASSA_ATTIVITA);
    expect(alta).toBeGreaterThan(bassa);
    expect(alta - bassa).toBeGreaterThan(0.5);
  });

  it('UT-FN-06: il default e un FN misurato diverso NON danno lo stesso indice', () => {
    const def = normalizeAmylaseActivity(DEFAULT_FALLING_NUMBER);
    expect(normalizeAmylaseActivity(FN_ALTA_ATTIVITA)).not.toBeCloseTo(def, 2);
  });

  it('UT-FN-07: le curve di lievitazione divergono in modo operativamente rilevante', () => {
    // 10 h a 25 °C: fuori dalla saturazione della Gompertz, dove la differenza
    // fra farine è visibile. A 24 h entrambe sono >98 % e il confronto perde senso.
    const pH = 5.8, ore = 10, muMax = 12, lambda = 1.2;
    const pctPer = (fn: number) => {
      const idx  = normalizeAmylaseActivity(fn);
      const rate = amylaseCorrectedRate(1.0, idx, 0, pH);   // kRatio = 1 a 25 °C
      return gompertz(rate * ore, muMax, lambda, 100);
    };
    const alta  = pctPer(FN_ALTA_ATTIVITA);
    const bassa = pctPer(FN_BASSA_ATTIVITA);
    expect(alta).toBeGreaterThan(bassa);
    // Non basta che differiscano: devono differire abbastanza da cambiare una decisione.
    expect(alta - bassa).toBeGreaterThan(5);
  });

  it('UT-FN-08: in un blend l\'indice segue le percentuali', () => {
    const soloAlta = blendAmylaseIndex([{ percentage: 100, FN: FN_ALTA_ATTIVITA }]);
    const metaMeta = blendAmylaseIndex([
      { percentage: 50, FN: FN_ALTA_ATTIVITA },
      { percentage: 50, FN: FN_BASSA_ATTIVITA },
    ]);
    const soloBassa = blendAmylaseIndex([{ percentage: 100, FN: FN_BASSA_ATTIVITA }]);
    expect(metaMeta).toBeLessThan(soloAlta);
    expect(metaMeta).toBeGreaterThan(soloBassa);
  });
});

describe('copertura del dato nel catalogo', () => {
  it('UT-FN-09: fallingNumberCoverage conta le farine, escludendo "custom"', () => {
    const c = fallingNumberCoverage();
    expect(c.total).toBe(FLOUR_DATABASE.filter(f => f.id !== 'custom').length);
    expect(c.measured).toBeLessThanOrEqual(c.total);
  });

  // Il dato NON è stato inventato: le schede tecniche dei molini italiani spesso
  // non pubblicano l'indice di caduta, e quelle reperite online sono scansioni
  // senza layer testo, non verificabili su fonte primaria.
  // Questo todo resta pendente finché il catalogo non viene popolato.
  // Quando lo sarà, sostituire con:
  //   expect(fallingNumberCoverage().measured).toBe(fallingNumberCoverage().total);
  it.todo('UT-FN-10: ogni farina del catalogo dichiara FN da scheda tecnica verificata');
});
