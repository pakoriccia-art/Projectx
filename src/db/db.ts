/**
 * PizzaMatrix — Database Schema
 * Dexie.js v4 + TypeScript
 * Spec: §5 KB v2.4.0-pre
 */

import Dexie, { type EntityTable } from 'dexie';

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
  maturationPct: number;
  estimatedPH?: number;
  wEffective: number;

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

// ─── Database ────────────────────────────────────────────────────────────────

class PizzaMatrixDB extends Dexie {
  sessions!: EntityTable<Session, 'id'>;
  process_log!: EntityTable<ProcessLogEntry, 'id'>;
  alerts!: EntityTable<Alert, 'id'>;
  projection_cache!: EntityTable<ProjectionCache, 'id'>;

  constructor() {
    super('PizzaMatrixDB');

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
