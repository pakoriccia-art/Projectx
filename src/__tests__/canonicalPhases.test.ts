/**
 * PizzaMatrix — Canonical Phase Model tests T1-T8 (v2.4.20)
 *
 * T1 Uniformità    — ogni stile/protocollo → SEMPRE [puntata, staglio, appretto, cottura] in ordine.
 * T2 Durata zero   — staglioH ≈ 0 → marker STAGLIO comunque presente.
 * T3 Riconciliaz.  — chip (canonicalDisplayLabel), strip e header derivano lo STESSO env per la fase.
 * T4 Cottura sempre— COTTURA ★ presente a fine timeline in tutti gli stili (isBake, non tappabile).
 * T5 Tap uniforme  — fasi future tappabili; transitionTo monotòno in PHASE_ORDER; passato/corrente no.
 * T6 Fuori-protoc. — all-TA → APPRETTO·TA senza frigo; con frigo → APPRETTO·TC coerente.
 * T7 Reattività    — timeline diversa → fasi ri-derivate coerenti (funzione pura).
 * T8 No deadline   — COTTURA a mixStart + Σ(durate); nessuna slack-absorption.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCanonicalPhases, canonicalDisplayLabel, type CanonicalPhase,
} from '../engine/canonicalPhases';
import { buildHeaderTempString } from '../engine/outOfProtocol';
import { PHASE_ORDER } from '../engine';
import type { PhaseSegment } from '../db/db';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const START = Date.UTC(2026, 5, 13, 8, 0, 0); // mixStart
const H = 3_600_000;

function seg(
  phaseType: string, startH: number, endH: number, t: number,
  status: PhaseSegment['status'] = 'planned',
): PhaseSegment {
  return { id: `${phaseType}-${startH}`, phaseType, startElapsedH: startH, endElapsedH: endH, ambientTempC: t, status };
}

// napoletana ta_only: [bulk_room, balled_room, proofing]
function timelineAllTA(staglioH = 0.5): PhaseSegment[] {
  return [
    seg('bulk_room',   0,        8,            22),
    seg('balled_room', 8,        8 + staglioH, 22),
    seg('proofing',    8 + staglioH, 12 + staglioH, 22),
  ];
}

// contemporanea misto_ta_tc: [bulk_room, balled_room, balled_fridge, proofing]
function timelineFridge(): PhaseSegment[] {
  return [
    seg('bulk_room',     0,    4,    22),
    seg('balled_room',   4,    4.5,  22),
    seg('balled_fridge', 4.5,  16.5, 4),
    seg('proofing',      16.5, 20.5, 22),
  ];
}

// tc_only: [bulk_fridge, balled_room]
function timelineTcOnly(): PhaseSegment[] {
  return [
    seg('bulk_fridge', 0,  24,   4),
    seg('balled_room', 24, 26.5, 22),
  ];
}

const KEYS = (ps: CanonicalPhase[]) => ps.map(p => p.key);

// ─── T1 — Uniformità ──────────────────────────────────────────────────────────
describe('T1 — uniformità: sempre puntata→staglio→appretto→cottura', () => {
  it('napoletana (ta_only) → almeno [puntata, staglio, appretto, cottura] in ordine', () => {
    const ps = deriveCanonicalPhases(timelineAllTA(), START, START);
    expect(KEYS(ps)).toEqual(['puntata', 'staglio', 'appretto', 'cottura']);
  });

  it('contemporanea (misto_ta_tc) → contiene le 4 canoniche in ordine', () => {
    const ps = deriveCanonicalPhases(timelineFridge(), START, START);
    const keys = KEYS(ps);
    expect(keys[0]).toBe('puntata');
    expect(keys[1]).toBe('staglio');
    expect(keys[2]).toBe('appretto');
    expect(keys[keys.length - 1]).toBe('cottura');
  });

  it('tc_only → le 4 canoniche presenti in ordine', () => {
    const ps = deriveCanonicalPhases(timelineTcOnly(), START, START);
    expect(KEYS(ps)).toEqual(['puntata', 'staglio', 'appretto', 'cottura']);
    expect(ps[0].env).toBe('TC'); // puntata in frigo
  });
});

// ─── T2 — Durata zero ───────────────────────────────────────────────────────
describe('T2 — staglioH ≈ 0: marker STAGLIO comunque presente', () => {
  it('staglio presente anche con durata nulla', () => {
    const ps = deriveCanonicalPhases(timelineAllTA(0), START, START);
    const staglio = ps.find(p => p.key === 'staglio');
    expect(staglio).toBeDefined();
    expect(staglio!.isMarker).toBe(true);
    // marker puntuale: start === end
    expect(staglio!.startMs).toBe(staglio!.endMs);
  });
});

// ─── T3 — Riconciliazione env (chip == strip == header) ──────────────────────
describe('T3 — env coerente tra chip, strip e header', () => {
  it('appretto TC: display label e header concordano sul TC', () => {
    const tl = timelineFridge();
    const ps = deriveCanonicalPhases(tl, START, START);
    const appretto = ps.find(p => p.key === 'appretto')!;
    expect(appretto.env).toBe('TC');
    expect(canonicalDisplayLabel(appretto)).toBe('APPRETTO · TC');
    expect(buildHeaderTempString(tl, 22)).toContain('TC');
  });

  it('appretto TA: nessun TC nel chip né nell’header', () => {
    const tl = timelineAllTA();
    const ps = deriveCanonicalPhases(tl, START, START);
    const appretto = ps.find(p => p.key === 'appretto')!;
    expect(appretto.env).toBe('TA');
    expect(canonicalDisplayLabel(appretto)).toBe('APPRETTO · TA');
    expect(buildHeaderTempString(tl, 22)).not.toContain('TC');
  });
});

// ─── T4 — Cottura sempre presente ────────────────────────────────────────────
describe('T4 — COTTURA ★ sempre a fine timeline', () => {
  for (const [name, tl] of [
    ['napoletana', timelineAllTA()],
    ['contemporanea', timelineFridge()],
    ['tc_only', timelineTcOnly()],
  ] as const) {
    it(`${name}: ultima fase = cottura, isBake, non tappabile`, () => {
      const ps = deriveCanonicalPhases(tl, START, START);
      const last = ps[ps.length - 1];
      expect(last.key).toBe('cottura');
      expect(last.isBake).toBe(true);
      expect(last.tappable).toBe(false);
      expect(last.env).toBeNull();
    });
  }
});

// ─── T5 — Tap uniforme + PHASE_ORDER monotòno ────────────────────────────────
describe('T5 — tap uniforme: future tappabili, transitionTo monotòno, passato/corrente no', () => {
  it('transitionTo strettamente crescente in PHASE_ORDER', () => {
    const ps = deriveCanonicalPhases(timelineFridge(), START, START);
    const idx = ps.map(p => PHASE_ORDER.indexOf(p.transitionTo as any));
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    }
  });

  it('una fase futura (start oltre now+5min) è tappabile; cottura mai', () => {
    // now PRIMA dell'inizio → tutte future
    const ps = deriveCanonicalPhases(timelineFridge(), START, START - H);
    const appretto = ps.find(p => p.key === 'appretto')!;
    expect(appretto.state).toBe('future');
    expect(appretto.tappable).toBe(true);
    expect(ps.find(p => p.key === 'cottura')!.tappable).toBe(false);
  });

  it('fase corrente e passata NON tappabili', () => {
    // bulk_room current (status), balled_* planned; now a 2h
    const tl: PhaseSegment[] = [
      seg('bulk_room',   0,    4,    22, 'current'),
      seg('balled_room', 4,    4.5,  22, 'planned'),
      seg('proofing',    4.5,  8.5,  22, 'planned'),
    ];
    const now = START + 2 * H;
    const ps = deriveCanonicalPhases(tl, START, now);
    const puntata = ps.find(p => p.key === 'puntata')!;
    expect(puntata.state).toBe('current');
    expect(puntata.tappable).toBe(false);
  });

  it('passato (completed) non tappabile', () => {
    const tl: PhaseSegment[] = [
      seg('bulk_room',   0,   4,    22, 'completed'),
      seg('balled_room', 4,   4.5,  22, 'current'),
      seg('proofing',    4.5, 8.5,  22, 'planned'),
    ];
    const now = START + 4.2 * H;
    const ps = deriveCanonicalPhases(tl, START, now);
    const puntata = ps.find(p => p.key === 'puntata')!;
    expect(puntata.state).toBe('past');
    expect(puntata.tappable).toBe(false);
  });
});

// ─── T6 — Fuori-protocollo: env appretto segue la timeline effettiva ─────────
describe('T6 — env appretto coerente con timeline effettiva (frigo vs all-TA)', () => {
  it('timeline all-TA → appretto TA, nessun segmento frigo', () => {
    const ps = deriveCanonicalPhases(timelineAllTA(), START, START);
    expect(ps.find(p => p.key === 'appretto')!.env).toBe('TA');
  });

  it('timeline con frigo (confermata) → appretto TC', () => {
    const ps = deriveCanonicalPhases(timelineFridge(), START, START);
    expect(ps.find(p => p.key === 'appretto')!.env).toBe('TC');
  });
});

// ─── T7 — Reattività (funzione pura: input diverso → output diverso) ─────────
describe('T7 — reattività: timeline diversa → fasi ri-derivate', () => {
  it('cambio timeline (TA→frigo) ribalta env appretto senza mutare input', () => {
    const ta = timelineAllTA();
    const taSnapshot = JSON.stringify(ta);
    const psTA = deriveCanonicalPhases(ta, START, START);
    const psTC = deriveCanonicalPhases(timelineFridge(), START, START);
    expect(psTA.find(p => p.key === 'appretto')!.env).toBe('TA');
    expect(psTC.find(p => p.key === 'appretto')!.env).toBe('TC');
    expect(JSON.stringify(ta)).toBe(taSnapshot); // nessuna mutazione
  });
});

// ─── T8 — No deadline: cottura = mixStart + Σ(durate) ────────────────────────
describe('T8 — COTTURA a mixStart + Σ(durate), nessuna slack-absorption', () => {
  it('cottura.startMs === START + (fine proofing)·3.6e6 (all-TA)', () => {
    const ps = deriveCanonicalPhases(timelineAllTA(0.5), START, START);
    const cottura = ps.find(p => p.key === 'cottura')!;
    // bulk 0-8 · balled_room 8-8.5 · proofing 8.5-12.5 → fine timeline 12.5h
    const endH = 12.5;
    expect(cottura.startMs).toBe(START + endH * H);
  });
});

// ─── TEMPERING condizionale ──────────────────────────────────────────────────
describe('TEMPERING — presente solo se temperingH > 0 dopo appretto TC', () => {
  it('temperingH > 0 → TEMPERING separato; appretto esclude il proofing finale', () => {
    const ps = deriveCanonicalPhases(timelineFridge(), START, START, { temperingH: 4 });
    expect(KEYS(ps)).toEqual(['puntata', 'staglio', 'appretto', 'tempering', 'cottura']);
    const tempering = ps.find(p => p.key === 'tempering')!;
    expect(tempering.env).toBe('TA');
    // appretto finisce dove inizia il tempering (proofing finale)
    const appretto = ps.find(p => p.key === 'appretto')!;
    expect(appretto.endMs).toBe(tempering.startMs);
  });

  it('temperingH = 0 → nessun TEMPERING; appretto ingloba il proofing', () => {
    const ps = deriveCanonicalPhases(timelineFridge(), START, START, { temperingH: 0 });
    expect(KEYS(ps)).toEqual(['puntata', 'staglio', 'appretto', 'cottura']);
  });
});
