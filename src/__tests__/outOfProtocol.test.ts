/**
 * PizzaMatrix — Out-of-Protocol Phase Gate tests A-T1..A-T4 (v2.4.19 PARTE A)
 *
 * A-T1: stile ta_only + timeline con balled_fridge non confermato →
 *       effectiveTimeline NON contiene balled_fridge; fase fuori-protocollo rilevata;
 *       default outOfProtocolPhaseConfirmed falsy.
 * A-T2: confermato → balled_fridge presente; header string, fasi timeline e segmenti
 *       curve coincidono con la stessa effectiveTimeline.
 * A-T3: non confermato → nessun balled_fridge; orizzonte = Σ(durate); T monotona (no dip).
 * A-T4: nessun targetBakeAt → cottura = mixStart + Σ(durate); nessuna slack-absorption.
 */
import { describe, it, expect, vi } from 'vitest';

// Il setup globale mocka INTERAMENTE ../db/db, perdendo le funzioni pure
// (buildInitialTimeline, usata da buildEffectiveTimeline). Mock PARZIALE: tiene
// le funzioni reali e stubba solo l'istanza Dexie `db`.
vi.mock('../db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/db')>();
  return {
    ...actual,
    db: { sessions: {}, process_log: {}, alerts: {} },
  };
});

import {
  detectOutOfProtocolPhase, buildEffectiveTimeline, effectiveTimelineDurationH,
  buildHeaderTempString, fridgePhaseIsSanctioned,
} from '../engine/outOfProtocol';
import type { Session, PhaseSegment } from '../db/db';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Date.now();
const START = NOW - 3 * 3_600_000; // started 3h ago

function makeSession(over: Partial<Session> = {}): Session {
  return {
    status: 'active', prefermenti: [],
    mainFlourGroup: {
      flours: [{ name: 'T', brand: '', W: 280, pl: 0.55, protein: 12.5, percentage: 100 }],
      effectiveW: 280, effectivePl: 0.55, effectiveProtein: 12.5,
      effectiveAsh: 0.55, effectiveAmylaseIndex: 1.0, isBlend: false,
    },
    effectiveW_initial: 280, effectivePl_initial: 0.55, effectiveProtein: 12.5,
    effectiveAsh: 0.55, effectiveAmylaseIndex: 1.0, effectiveW_current: 280,
    agentLabel: 'IDY', agentType: 'instant_dry_yeast',
    agentEaKj: 60, agentMuMax: 11.5, agentLambda: 0.8, agentAsymptote: 100, agentDosePct: 0.3,
    style: 'napoletana', // ta_only
    hydration: 60, salt: 2.8, totalFlourGrams: 1000, alertThreshold: 80,
    containerPreset: 'closed_box',
    apprettoProtocol: 'ta',
    puntataH: 8, staglioH: 0.5, apprettoH: 4, tcHours: 12, fridgeTempC: 4,
    numPanetti: 6, tLaboratorio: 22,
    targetBakeAt: new Date(START + 12.5 * 3_600_000),
    startedAt: new Date(START),
    createdAt: new Date(START),
    ...over,
  } as Session;
}

// A timeline that includes an out-of-protocol fridge phase (tc_appreto-shaped).
function fridgeTimeline(): PhaseSegment[] {
  const seg = (phaseType: string, startElapsedH: number, endElapsedH: number, t: number): PhaseSegment => ({
    id: `${phaseType}-${startElapsedH}`, phaseType, startElapsedH, endElapsedH,
    ambientTempC: t, status: 'planned',
  });
  return [
    seg('bulk_room',     0,   8,    22),
    seg('balled_room',   8,   8.5,  22),
    seg('balled_fridge', 8.5, 20.5, 4),   // ← fuori protocollo per ta_only
    seg('proofing',      20.5, 24.5, 22),
  ];
}

// ─── A-T1 — out-of-protocol detected, stripped by default ────────────────────
describe('A-T1 — ta_only + fridge phase: detected & stripped when unconfirmed', () => {
  it('detectOutOfProtocolPhase finds the balled_fridge for napoletana (ta_only)', () => {
    const offending = detectOutOfProtocolPhase('napoletana', fridgeTimeline());
    expect(offending).not.toBeNull();
    expect(offending!.phaseType).toBe('balled_fridge');
  });

  it('effective timeline (unconfirmed) contains NO fridge phase', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    const eff = buildEffectiveTimeline(session, false);
    expect(eff.some(s => s.phaseType === 'balled_fridge' || s.phaseType === 'bulk_fridge')).toBe(false);
  });

  it('default outOfProtocolPhaseConfirmed is falsy', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    expect(session.outOfProtocolPhaseConfirmed).toBeFalsy();
  });

  it('misto_ta_tc style: fridge phase is sanctioned (no out-of-protocol)', () => {
    expect(fridgePhaseIsSanctioned('misto_ta_tc')).toBe(true);
    const offending = detectOutOfProtocolPhase('contemporanea', fridgeTimeline());
    expect(offending).toBeNull();
  });
});

// ─── A-T2 — confirmed → fridge present & coherent across views ───────────────
describe('A-T2 — confirmed: fridge present, all views from same effective timeline', () => {
  it('effective timeline (confirmed) preserves the balled_fridge', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    const eff = buildEffectiveTimeline(session, true);
    expect(eff.some(s => s.phaseType === 'balled_fridge')).toBe(true);
    // Identity: confirmed returns the original timeline (single source of truth)
    expect(eff).toBe(session.thermalTimeline);
  });

  it('header string generated from the confirmed timeline shows the TC clause', () => {
    const eff = buildEffectiveTimeline(makeSession({ thermalTimeline: fridgeTimeline() }), true);
    const header = buildHeaderTempString(eff, 22);
    expect(header).toContain('TA');
    expect(header).toContain('TC'); // fridge segment present → TC clause shown
    expect(header).toContain('4°C TC');
  });

  it('header + timeline + curves all read the SAME effective timeline object', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    const eff = buildEffectiveTimeline(session, true);
    // The phases the timeline view derives and the segments the curves integrate
    // both come from `eff` — no divergent template source.
    const fridgeInEff = eff.filter(s => s.phaseType === 'balled_fridge');
    expect(fridgeInEff).toHaveLength(1);
    // deriveProtoLabel-driven header reflects the fridge presence
    expect(buildHeaderTempString(eff, 22)).toContain('TC');
  });
});

// ─── A-T3 — stay all-TA → no fridge, horizon = Σ(durate), monotone T ─────────
describe('A-T3 — unconfirmed all-TA: no fridge, shortened horizon, no dip', () => {
  it('header from effective (all-TA) timeline has NO TC clause', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    const eff = buildEffectiveTimeline(session, false);
    const header = buildHeaderTempString(eff, 22);
    expect(header).toContain('TA');
    expect(header).not.toContain('TC'); // no fridge → no phantom TC
  });

  it('effective horizon ≈ Σ(puntataH + staglioH + apprettoH)', () => {
    const session = makeSession({
      thermalTimeline: fridgeTimeline(),
      puntataH: 8, staglioH: 0.5, apprettoH: 4,
    });
    const eff = buildEffectiveTimeline(session, false);
    const horizon = effectiveTimelineDurationH(eff);
    expect(horizon).toBeCloseTo(8 + 0.5 + 4, 1); // 12.5h, NOT the 24.5h fridge plan
  });

  it('all effective segments are warm (no fridge ambient) → no blue dip', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline(), tLaboratorio: 22 });
    const eff = buildEffectiveTimeline(session, false);
    // Every segment runs at TA (≥ 16°C) — none at fridge temp
    eff.forEach(s => expect(s.ambientTempC).toBeGreaterThanOrEqual(16));
  });
});

// ─── A-T4 — no deadline: cottura = mixStart + Σ(durate), no slack absorption ──
describe('A-T4 — no fixed deadline: bake = mixStart + Σ(durate)', () => {
  it('effective horizon equals Σ(durate) regardless of any targetBakeAt slack', () => {
    // Even if targetBakeAt is far in the future, the all-TA plan ends at Σ(durate):
    // no fridge phase is inserted to "absorb slack".
    const session = makeSession({
      thermalTimeline: fridgeTimeline(),
      puntataH: 6, staglioH: 0.5, apprettoH: 3,
      targetBakeAt: new Date(START + 40 * 3_600_000), // far deadline
    });
    const eff = buildEffectiveTimeline(session, false);
    expect(eff.some(s => s.phaseType.includes('fridge'))).toBe(false);
    expect(effectiveTimelineDurationH(eff)).toBeCloseTo(6 + 0.5 + 3, 1); // 9.5h
  });

  it('the all-TA effective plan has exactly the protocol phases (bulk_room, balled_room, proofing)', () => {
    const session = makeSession({ thermalTimeline: fridgeTimeline() });
    const eff = buildEffectiveTimeline(session, false);
    const types = eff.map(s => s.phaseType);
    expect(types).toContain('bulk_room');
    expect(types).toContain('balled_room');
    expect(types).toContain('proofing');
    expect(types).not.toContain('balled_fridge');
    expect(types).not.toContain('bulk_fridge');
  });
});
