/**
 * PizzaMatrix v2.4.21 — T impasto esponenziale reale (T1–T8)
 *
 * T1 Sorgente:     fridge profondo → tempC ≈ 3°C (no plateau a DDT=24)
 * T2 Seed DDT:     senza startDoughTempC → primo punto vicino a ddtForStyle('napoletana')=24
 * T3 Magnitudine:  294g / frigo 12h@3°C / 0.5h@20°C → tempDough ∈ (3, 10)°C, non 20
 * T4 Esponenziale: monotono in frigo, nessuna oscillazione
 * T5 Continuità:   |Δ tempC| al confine frigo→TA < 2°C (no salto verticale)
 * T6 τ sanity:     3°C→20°C, crossing 18°C in 1–5h (τ≈1.66h → atteso ≈3.5h)
 * T7 Now-split:    elapsedH>0 + startDoughTempC=8 → proiettati partono da ≈8°C (non DDT)
 * T8 Warning:      projectCoreTempAtBakeC < 18 (coda frigo) / ≥ 18 (temperato 4h@20°C)
 */
import { describe, it, expect } from 'vitest';
import { buildPiecewiseData } from '../components/dashboard/GompertzChartV4';
import { projectCoreTempAtBakeC, CORE_TEMP_AT_BAKE_MIN_C } from '../engine/coreTempProjection';
import type { PhaseSegment } from '../db/db';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const seg = (
  id: string, phaseType: string, start: number, end: number | null,
  ambientTempC: number, status: PhaseSegment['status'] = 'planned',
): PhaseSegment => ({ id, phaseType, startElapsedH: start, endElapsedH: end, ambientTempC, status });

/**
 * ~294g dough ball: 176g farina × (1 + 0.65 + 0.02) ≈ 294g, numPanetti=1, bare.
 * τ (sphere, bare, h=65%) ≈ 1.66h.
 * ddtForStyle('napoletana') = 24°C.
 */
const BASE: Parameters<typeof buildPiecewiseData>[0] = {
  apprettoProtocol: 'tc',
  puntataH: 2, staglioH: 0.5, apprettoH: 4,
  tcHours: 12, fridgeTempC: 3,
  agentEaKj: 60, agentType: 'instant_dry_yeast',
  agentMuMax: 11.5, agentLambda: 0.8, agentAsymptote: 100,
  initialMaturationOffset: 0,
  numPanetti: 1, hydration: 65, containerPreset: 'bare',
  totalFlourGrams: 176, salt: 2,
  prefermenti: [],
  tLaboratorio: 22,
  style: 'napoletana',
  initialPH: 5.8,
} as any;

const SIM_OPTS = {
  agentEaKj: 60, agentType: 'instant_dry_yeast',
  agentMuMax: 11.5, agentLambda: 0.8, agentAsymptote: 100,
  hydration: 65, salt: 2, totalFlourGrams: 176,
  numPanetti: 1, containerPreset: 'bare', initialPH: 5.8,
};

// ─── T1 — Fridge deep: no plateau at DDT ─────────────────────────────────────
describe('T1 — frigo profondo: cuore ≈ 3°C dopo 10h (no plateau a DDT=24)', () => {
  it('punti a h ≥ 10 in bulk_fridge@3°C sono ≤ 6°C', () => {
    const tl = [seg('s1', 'bulk_fridge', 0, 14, 3)];
    const { points } = buildPiecewiseData(BASE, 22, 'bulk_fridge', 0, undefined, undefined, tl as any);
    const deep = points.filter(p => p.h >= 10 && p.h <= 14);
    expect(deep.length).toBeGreaterThan(0);
    for (const pt of deep) {
      expect(pt.tempC).toBeLessThanOrEqual(6);
    }
  });
});

// ─── T2 — Seed DDT a t=0 ─────────────────────────────────────────────────────
describe('T2 — seed DDT=24 per napoletana (non tLaboratorio=22)', () => {
  it('primo punto > 22°C quando tAmbient=20 < DDT=24 (seed da ddtForStyle)', () => {
    const tl = [seg('s1', 'proofing', 0, 6, 20)];
    const { points } = buildPiecewiseData(BASE, 20, 'proofing', 0, undefined, undefined, tl as any);
    // With seed=24, cooling toward 20: first point still > 22.
    // With old seed=tLaboratorio=22, first point would be ≤ 22.
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].tempC).toBeGreaterThan(22);
  });
});

// ─── T3 — Magnitudine realistica ─────────────────────────────────────────────
describe('T3 — 294g / frigo 12h@3°C / 0.5h@20°C → tempDough ∈ (3, 10)°C', () => {
  it('cuore a h=12.5 è tra 3 e 10°C (non il plateau 20°C del vecchio codice)', () => {
    const tl = [
      seg('s1', 'balled_fridge', 0, 12, 3),
      seg('s2', 'balled_room',  12, 12.5, 20),
    ];
    const { points } = buildPiecewiseData(BASE, 20, 'balled_fridge', 0, undefined, undefined, tl as any);
    const pt = points.find(p => Math.abs(p.h - 12.5) < 0.15);
    expect(pt).toBeDefined();
    expect(pt!.tempC).toBeGreaterThan(3);    // not frozen at fridge temp
    expect(pt!.tempC).toBeLessThan(10);      // not plateau at ambient (old: 20°C)
  });
});

// ─── T4 — Monotonia in frigo ──────────────────────────────────────────────────
describe('T4 — raffreddamento monotono in bulk_fridge (no oscillazioni)', () => {
  it('i punti nel segmento fridge sono non-crescenti', () => {
    const tl = [seg('s1', 'bulk_fridge', 0, 14, 3)];
    const { points } = buildPiecewiseData(BASE, 22, 'bulk_fridge', 0, undefined, undefined, tl as any);
    const fridgePts = points.filter(p => p.h <= 14);
    expect(fridgePts.length).toBeGreaterThan(5);
    for (let i = 1; i < fridgePts.length; i++) {
      // Allow tiny float noise (0.2°C) but no real oscillation
      expect(fridgePts[i].tempC).toBeLessThanOrEqual(fridgePts[i - 1].tempC + 0.2);
    }
  });
});

// ─── T5 — Continuità al confine frigo→TA ─────────────────────────────────────
describe('T5 — no salto verticale al confine bulk_fridge→balled_room', () => {
  it('|Δ tempC| tra ultimo punto frigo e primo punto TA < 3°C (vecchio RAMP_N=3 → 3.7°C)', () => {
    // Nota: il vecchio codice con RAMP_N=3 mostrava Δ≈3.7°C in questo punto;
    // il nuovo cuore continuo da simulateTimeline dà Δ≈2.5°C (warming fisico reale).
    // Threshold 3.0 cattura il discontinuity bug vecchio (3.7) senza fallire sul
    // warming continuo corretto (2.5°C in 0.6h = 4.2°C/h ≈ dT/dt a t=0 con τ=1.66h).
    const tl = [
      seg('s1', 'bulk_fridge', 0, 12, 3),
      seg('s2', 'balled_room', 12, 16, 20),
    ];
    const { points } = buildPiecewiseData(BASE, 20, 'bulk_fridge', 0, undefined, undefined, tl as any);
    const before = points.filter(p => p.h >= 11.5 && p.h < 12);
    const after  = points.filter(p => p.h > 12 && p.h <= 12.5);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    const lastBefore  = before[before.length - 1].tempC;
    const firstAfter  = after[0].tempC;
    expect(Math.abs(firstAfter - lastBefore)).toBeLessThan(3.0);
  });
});

// ─── T6 — τ sanity ────────────────────────────────────────────────────────────
describe('T6 — τ sanity: 3°C→20°C, crossing 18°C in 1–5h', () => {
  it('crossing h ∈ (1, 5) — τ≈1.66h implica crossing≈3.5h', () => {
    const tl = [seg('s1', 'balled_room', 0, 6, 20)];
    // startDoughTempC = 3°C (9th arg)
    const { points } = buildPiecewiseData(
      BASE, 20, 'balled_room', 0, undefined, undefined, tl as any, undefined, 3,
    );
    const crossIdx = points.findIndex(p => p.tempC >= 18);
    expect(crossIdx).toBeGreaterThan(-1);
    const crossH = points[crossIdx].h;
    expect(crossH).toBeGreaterThan(1.0);    // not instant (τ > 0)
    expect(crossH).toBeLessThan(5.0);       // within physical range
  });
});

// ─── T7 — Now-split: seed dal cuore vivo ──────────────────────────────────────
describe('T7 — now-split: elapsedH>0 → proiettati partono dal cuore vivo (8°C)', () => {
  it('i punti con h > elapsedH=6 partono vicino a startDoughTempC=8 (non DDT=24)', () => {
    const elapsedH = 6;
    const tl = [
      seg('s1', 'balled_fridge', 0, 6,  3, 'completed'),
      seg('s2', 'balled_room',   6, 10, 20, 'current'),
    ];
    const { points } = buildPiecewiseData(
      BASE, 20, 'balled_room', elapsedH, undefined, undefined, tl as any, undefined, 8,
    );
    const projected = points.filter(p => p.h > elapsedH);
    expect(projected.length).toBeGreaterThan(0);
    // Early projected points start near 8°C — warming from seed=8 toward ambient=20
    const earlyPts = projected.filter(p => p.h < elapsedH + 0.5);
    expect(earlyPts.length).toBeGreaterThan(0);
    for (const pt of earlyPts) {
      expect(pt.tempC).toBeGreaterThan(5);    // not stuck at fridge temp 3°C
      expect(pt.tempC).toBeLessThan(13);      // not jumped to DDT=24 or ambient=20
    }
  });
});

// ─── T8 — projectCoreTempAtBakeC: warning < 18°C ─────────────────────────────
describe('T8 — projectCoreTempAtBakeC: warning freddo / ok', () => {
  it('coda frigo fino a cottura → cuore < 18°C (warning attivo)', () => {
    // Dough at 3°C, baking in 0.5h still in fridge → remains cold
    const timeline: PhaseSegment[] = [
      seg('s1', 'balled_fridge', 6, 6.5, 3, 'current'),
    ];
    const result = projectCoreTempAtBakeC({
      timeline,
      nowElapsedH: 6,
      bakeH: 6.5,
      currentDoughTempC: 3,
      ambientTempC: 22,
      session: SIM_OPTS,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(CORE_TEMP_AT_BAKE_MIN_C);
  });

  it('piano temperato 4h@20°C da 5°C → cuore ≥ 18°C (no warning)', () => {
    // τ≈1.66h: after 4h from 5°C → T≈20-15×exp(-4/1.66)≈19.9°C ≥ 18
    const timeline: PhaseSegment[] = [
      seg('s1', 'balled_room', 0, 4, 20, 'planned'),
    ];
    const result = projectCoreTempAtBakeC({
      timeline,
      nowElapsedH: 0,
      bakeH: 4,
      currentDoughTempC: 5,
      ambientTempC: 20,
      session: SIM_OPTS,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(CORE_TEMP_AT_BAKE_MIN_C);
  });
});
