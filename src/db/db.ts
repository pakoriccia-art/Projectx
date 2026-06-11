/**
 * PizzaMatrix — Database Schema
 * Dexie.js v4 + TypeScript
 * Spec: §5 KB v2.4.0-pre
 */

import Dexie, { type EntityTable } from 'dexie';
import type { OvenProfile } from '../engine/bake';

// ─── Value Objects ───────────────────────────────────────────────────────────

export interface FlourSpec {
  name: string;
  brand: string;
  W: number;                           // Forza alveografica [80–500]
  pl: number;                          // Rapporto P/L [0.2–1.2]
  protein: number;                     // Proteine % [7–17]
  FN?: number;                         // Falling Number [s]; default DEFAULT_FN=340
  ash?: number;                        // Ceneri %; default DEFAULT_ASH=0.55
  tipo?: '00' | '0' | '1' | '2' | 'integrale';
}

export interface FlourComponent extends FlourSpec {
  percentage: number;                  // [0–100], Σ = 100 ±0.01
}

export interface FlourGroup {
  flours: FlourComponent[];            // 1–3 farine
  effectiveW: number;                  // W blend (v2.4.0: non-lineare)
  effectivePl: number;
  effectiveProtein: number;
  effectiveAsh: number;                // SEMPRE popolato (§2.13)
  effectiveAmylaseIndex: number;
  isBlend: boolean;
  blendNote?: string;                  // es. "W spread elevato"
}

export interface MaltSpec {
  dosePercent: number;                 // % su farina [0.0–1.0]
  dpLintner: number;                   // Potere diastatico °Lintner; default 200
  addedTo: 'final_dough' | 'prefermento_1' | 'prefermento_2';
}

export interface PrefermentoState {
  maturationPct?: number;
  pH?: number;
  W_decayed: number;
  pl_modified: number;
  amylase_index: number;
  adu?: number;
  ready: boolean;
}

export interface PrefermentoComponent {
  id: string;
  type: 'poolish' | 'biga' | 'autolysis' | 'riporto';
  flourGroup: FlourGroup;
  flourFraction: number;               // % della farina totale [0–100]
  tempC: number;
  durationH: number;
  yeastPct?: number;                   // undefined per autolysis e riporto
  hydration: number;
  state?: PrefermentoState;
}

// ─── Thermal Timeline ─────────────────────────────────────────────────────────

export interface PhaseSegment {
  id: string;
  phaseType: string;                 // 'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking'
  startElapsedH: number;             // ore da session.startedAt
  endElapsedH: number | null;        // null = segmento corrente aperto
  ambientTempC: number;              // temperatura di QUESTO segmento (bloccata al completed)
  status: 'completed' | 'current' | 'planned';
}

// ─── Session Entity ──────────────────────────────────────────────────────────

export interface Session {
  id?: number;                         // auto-increment (Dexie)
  status: 'planning' | 'active' | 'completed' | 'aborted';

  // Prefermenti (0–2)
  prefermenti: PrefermentoComponent[];
  mainFlourGroup: FlourGroup;

  // Valori effettivi all'avvio impasto
  effectiveW_initial: number;
  effectivePl_initial: number;
  effectiveProtein: number;
  effectiveAsh: number;
  effectiveAmylaseIndex: number;
  effectiveW_current: number;

  // Agente lievitante
  agentLabel: string;
  agentType: 'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat';
  agentEaKj: number;
  agentMuMax: number;
  agentLambda: number;
  agentAsymptote: number;
  agentDosePct: number;

  // Ricetta
  style: 'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle';
  hydration: number;
  salt: number;                        // % su farina (baker's %)
  totalFlourGrams: number;
  alertThreshold: number;

  // Contenitore (§2.5)
  containerPreset: 'bare' | 'film' | 'open_box' | 'glass_covered' | 'plastic_bag' | 'closed_box' | 'closed_box_double';

  // Protocollo fermentazione
  apprettoProtocol: 'ta' | 'tc' | 'tc_puntata' | 'tc_appreto';
  puntataH: number;
  staglioH: number;
  apprettoH: number;
  tcHours?: number;
  fridgeTempC?: number;            // Temperatura frigo per protocolli TC; default 4°C

  // v2.4.0 — nuovi campi Schema
  numPanetti?: number;                 // §2.14.4 inerzia bifase
  altitudeM?: number;                  // §2.16 compensazione altitudine; default 0
  waterHardnessPpm?: number;           // §2.17 durezza acqua; default 150
  malt?: MaltSpec;                     // §2.15 malto diastatico
  kneadingMethod?: string;             // §2.7 metodo impastamento per calcolo DDT acqua
  tLaboratorio?: number;               // §2.7 T ambiente al momento dell'impasto [°C]
  fatPct?: number;                     // §5.4 grasso baker's % [0–10]; default 0

  // Stato iniziale combinato (pre-fermenti)
  initialMaturationOffset?: number;   // [0, 1]
  initialPH?: number;
  combinedInitialState?: object;      // CombinedInitialState serializzato

  // Timing
  targetBakeAt: Date;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;

  // Outcome
  peakMaturation?: number;
  finalAdu?: number;
  userNotes?: string;
  alertsCount?: number;
  outcomeRating?: 'excellent' | 'good' | 'ok' | 'poor';

  // Cache ultima entry process_log (per dashboard senza query)
  latestProcessEntry?: ProcessLogEntry;

  // ThermalTimeline v2.4.2: lista persistente di segmenti di fase con temperature bloccate
  thermalTimeline?: PhaseSegment[];
  bakeTargetElapsedH?: number;       // (targetBakeAt - startedAt) / 3600000

  // Service-Window planner v2.4.2: soglia anti-bolle calibrabile (% lievitazione)
  bubbleThresholdPct?: number;       // default 92 (SERVICE_WINDOW_DEFAULTS)

  // v2.4.19 PARTE A: conferma esplicita di una fase fuori dal protocollo_preferito
  // dello stile (es. fase frigo in stile ta_only). Default falsy = NON confermato →
  // la timeline effettiva resta all-TA. NON indicizzato: nessun bump versione Dexie.
  outOfProtocolPhaseConfirmed?: boolean;

  // v2.4.18 — modulo cottura (validatore advisory, opzionale e NON indicizzato:
  // nessun bump di versione Dexie richiesto; le sessioni esistenti restano valide).
  ovenProfile?: OvenProfile;
}

// ─── Process Log Entry ───────────────────────────────────────────────────────

export interface ProcessLogEntry {
  id?: number;
  sessionId: number;
  recordedAt: Date;
  hlcTimestamp: string;
  deviceId: string;

  tempAmbient: number;
  tempDough: number;
  doughLocation: 'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking';
  tempSource: 'manual' | 'sensor_ble' | 'api_weather' | 'estimated';

  cumulativeAdu: number;
  deltaAdu: number;
  deltaTSeconds: number;
  maturationPct: number;       // lievitazione % (ADU lievito Gompertz) — storico
  leaveningPct?: number;       // alias esplicito lievitazione (v2.4.1)
  enzymaticMatPct?: number;    // maturazione enzimatica % (orologio two-clock, v2.4.1)
  estimatedPH?: number;
  wEffective: number;

  // v2.4.19 — accumulatori grezzi two-clock (§2.0). Provengono dallo SimulationState
  // corrente, MAI ricombinati o derivati l'uno dall'altro. Opzionali e non indicizzati:
  // nessun bump di versione Dexie. I record storici privi di questi campi restano
  // `undefined` (anti-fabbricazione): non vengono mai inventati in migrazione.
  enzAdu?: number;             // ADU enzimatico (Ea=47, indipendente da dose/sale)
  leavAdu?: number;            // ADU lievitazione (Gompertz)
  labAdu?: number;             // ADU LAB dual-pop (solo LM)
  currentPH?: number;          // pH end-of-tick (computeCurrentPH a monte)

  syncedAt: Date | null;
}

// ─── Alert ───────────────────────────────────────────────────────────────────

export interface Alert {
  id?: number;
  sessionId: number;
  level: 'info' | 'advisory' | 'critical' | 'collapse';
  type: string;
  message: string;
  createdAt: Date;
  readAt?: Date;
}

// ─── Projection Cache ────────────────────────────────────────────────────────

export interface ProjectionCache {
  id?: number;
  sessionId: number;
  computedAt: Date;
  data: object;
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────

/**
 * Costruisce la timeline pianificata iniziale dal protocollo della sessione.
 * I segmenti completed/current vengono determinati in base a startedAt + nowMs.
 */
export function buildInitialTimeline(session: {
  apprettoProtocol?: string;
  puntataH?: number;
  staglioH?: number;
  apprettoH?: number;
  tcHours?: number;
  fridgeTempC?: number;
  tLaboratorio?: number;
  startedAt?: Date | string;
}): PhaseSegment[] {
  const tA    = session.tLaboratorio ?? 22;
  const tC    = session.fridgeTempC  ?? 4;
  const proto = session.apprettoProtocol ?? 'ta';
  const punH  = session.puntataH  ?? 8;
  const stagH = session.staglioH  ?? 0.5;
  const appH  = session.apprettoH ?? 4;
  const tcH   = session.tcHours   ?? 12;

  const startMs     = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const nowElapsedH = Math.max(0, (Date.now() - startMs) / 3600000);

  const raw: Array<{ phaseType: string; durationH: number; ambientTempC: number }> =
    proto === 'ta' ? [
      { phaseType: 'bulk_room',     durationH: punH,  ambientTempC: tA },
      { phaseType: 'balled_room',   durationH: stagH, ambientTempC: tA },
      { phaseType: 'proofing',      durationH: appH,  ambientTempC: tA },
    ]
    : proto === 'tc' ? [
      { phaseType: 'bulk_fridge',   durationH: tcH,   ambientTempC: tC },
      { phaseType: 'balled_room',   durationH: stagH, ambientTempC: tA },
    ]
    : proto === 'tc_puntata' ? [
      { phaseType: 'bulk_fridge',   durationH: tcH,   ambientTempC: tC },
      { phaseType: 'balled_room',   durationH: stagH, ambientTempC: tA },
      { phaseType: 'proofing',      durationH: appH,  ambientTempC: tA },
    ]
    : /* tc_appreto */ [
      { phaseType: 'bulk_room',     durationH: punH,  ambientTempC: tA },
      { phaseType: 'balled_room',   durationH: stagH, ambientTempC: tA },
      { phaseType: 'balled_fridge', durationH: tcH,   ambientTempC: tC },
      { phaseType: 'proofing',      durationH: appH,  ambientTempC: tA },
    ];

  let h = 0;
  return raw.map(s => {
    const startH = h;
    h += s.durationH;
    const endH   = h;
    const status: PhaseSegment['status'] =
      endH   <= nowElapsedH ? 'completed' :
      startH <= nowElapsedH ? 'current'   : 'planned';
    return {
      id:            `${startMs}-${s.phaseType}-${Math.random().toString(36).slice(2, 7)}`,
      phaseType:     s.phaseType,
      startElapsedH: startH,
      endElapsedH:   endH,
      ambientTempC:  s.ambientTempC,
      status,
    };
  });
}

/**
 * Applica una transizione di fase alla timeline:
 * - chiude il segmento current a nowElapsedH (→ completed)
 * - apre un nuovo segmento current con la nuova fase e temperatura
 * - ripianta i segmenti planned restanti (stesse durate, tempi scalati)
 * I segmenti completed non vengono mai toccati.
 */
export function applyPhaseTransition(
  timeline: PhaseSegment[],
  newPhaseType: string,
  newAmbientTempC: number,
  nowElapsedH: number,
): PhaseSegment[] {
  // Chiude il segmento current
  const closed = timeline.map(seg =>
    seg.status === 'current'
      ? { ...seg, endElapsedH: nowElapsedH, status: 'completed' as const }
      : seg,
  );
  const completedSegs = closed.filter(s => s.status === 'completed');
  const plannedSegs   = closed.filter(s => s.status === 'planned');

  // Durata del nuovo segmento: dal planned corrispondente, o default 4h
  const matchingPlan = plannedSegs.find(s => s.phaseType === newPhaseType);
  const newDurH = matchingPlan && matchingPlan.endElapsedH != null
    ? Math.max(0.01, matchingPlan.endElapsedH - matchingPlan.startElapsedH)
    : 4;
  const newEndH = nowElapsedH + newDurH;

  const newCurrent: PhaseSegment = {
    id:            `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    phaseType:     newPhaseType,
    startElapsedH: nowElapsedH,
    endElapsedH:   newEndH,
    ambientTempC:  newAmbientTempC,
    status:        'current',
  };

  // Ripianta i planned restanti: stesse durate, tempi scalati da newEndH
  let lastEndH = newEndH;
  const remaining = plannedSegs
    .filter(s => s.phaseType !== newPhaseType)
    .map(s => {
      const dur    = s.endElapsedH != null ? Math.max(0.01, s.endElapsedH - s.startElapsedH) : 4;
      const startH = lastEndH;
      lastEndH     = startH + dur;
      return { ...s, startElapsedH: startH, endElapsedH: lastEndH, status: 'planned' as const };
    });

  return [...completedSegs, newCurrent, ...remaining];
}

// ─── Database ────────────────────────────────────────────────────────────────

class PizzaMatrixDB extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  process_log!: EntityTable<ProcessLogEntry, 'id'>;
  alerts!: EntityTable<Alert, 'id'>;
  projection_cache!: EntityTable<ProjectionCache, 'id'>;

  constructor() {
    super('PizzaMatrixDB');

    // Version 5 — ThermalTimeline: aggiunge thermalTimeline e bakeTargetElapsedH a sessions.
    // Migrazione: popola thermalTimeline per le sessioni esistenti usando buildInitialTimeline.
    this.version(5).stores({
      sessions:          '++id, status, createdAt, [status+createdAt], style',
      process_log:       '++id, [sessionId+recordedAt], sessionId, recordedAt',
      alerts:            '++id, sessionId, [sessionId+level], createdAt',
      projection_cache:  '++id, &sessionId, computedAt',
    }).upgrade(tx =>
      tx.table('sessions').toCollection().modify((session: any) => {
        if (!session.thermalTimeline) {
          session.thermalTimeline = buildInitialTimeline(session);
        }
        if (!session.bakeTargetElapsedH && session.startedAt && session.targetBakeAt) {
          const startMs = new Date(session.startedAt).getTime();
          const bakeMs  = new Date(session.targetBakeAt).getTime();
          session.bakeTargetElapsedH = Math.max(0, (bakeMs - startMs) / 3600000);
        }
      })
    );

    // Version 4 — two-clock: aggiunge enzymaticMatPct / leaveningPct a process_log
    // Nessuna migrazione dati necessaria (campi opzionali con default graceful).
    this.version(4).stores({
      sessions:          '++id, status, createdAt, [status+createdAt], style',
      process_log:       '++id, [sessionId+recordedAt], sessionId, recordedAt',
      alerts:            '++id, sessionId, [sessionId+level], createdAt',
      projection_cache:  '++id, &sessionId, computedAt',
    });

    // Version 3 — §5.1 KB
    // .upgrade() migra sessioni legacy con apprettoProtocol='misto' → 'tc_puntata'
    this.version(3).stores({
      sessions:          '++id, status, createdAt, [status+createdAt], style',
      process_log:       '++id, [sessionId+recordedAt], sessionId, recordedAt',
      alerts:            '++id, sessionId, [sessionId+level], createdAt',
      projection_cache:  '++id, &sessionId, computedAt',
    }).upgrade(tx =>
      tx.table('sessions').toCollection().modify((session: any) => {
        if (session.apprettoProtocol === 'misto') {
          session.apprettoProtocol = 'tc_puntata';
        }
      })
    );
  }
}

export const db = new PizzaMatrixDB();
