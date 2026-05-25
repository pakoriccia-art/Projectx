/**
 * PizzaMatrix — Global App Context
 * React Context + useReducer (§4.2 KB: Strategy Pattern, no Redux overhead)
 */
import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { Session, FlourGroup, PrefermentoComponent } from '../db/db';

// ─── Views ────────────────────────────────────────────────────────────────────
export type AppView = 'home' | 'wizard' | 'dashboard' | 'history' | 'rotta' | 'tools';

// ─── Wizard draft (built incrementally across steps) ─────────────────────────
export interface WizardDraft {
  // Step 1
  style?: 'napoletana' | 'contemporanea' | 'teglia' | 'pala' | 'nystyle';
  totalFlourGrams?: number;
  numPanetti?: number;
  // Step 2
  protocol?: 'direct' | 'single_pref' | 'mix_advanced';
  // Step 3
  mainFlourGroup?: FlourGroup;
  prefermenti?: PrefermentoComponent[];
  // Step 4
  hydration?: number;
  salt?: number;
  fat?: number;
  altitudeM?: number;
  waterHardnessPpm?: number;
  // Step 5
  agentType?: 'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat';
  agentDosePct?: number;
  maltDosePct?: number;
  maltDP?: number;
  // Step 6
  containerPreset?: Session['containerPreset'];
  // Step 7
  apprettoProtocol?: 'ta' | 'tc' | 'tc_puntata' | 'tc_appreto';
  puntataH?: number;
  staglioH?: number;
  apprettoH?: number;
  tcHours?: number;
  fridgeTempC?: number;
  targetBakeAt?: Date;
}

// ─── Real-time tick state ─────────────────────────────────────────────────────
export interface TickState {
  cumulativeAdu:  number;
  maturationPct:  number;
  tempDough:      number;
  tempAmbient:    number;
  estimatedPH:    number;
  W_current:      number;
  elapsedH:       number;
  doughLocation:  Session['apprettoProtocol'] extends string ? string : string;
  phase:          'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking';
  lastTickAt:     number;
}

// ─── App State ────────────────────────────────────────────────────────────────
export interface AppState {
  view:        AppView;
  wizardStep:  number;
  wizardDraft: WizardDraft;
  activeSession: Session | null;
  tickState:   TickState | null;
  alerts:      Array<{ id: string; level: 'info' | 'advisory' | 'critical' | 'collapse'; message: string; timestamp: number }>;
}

const INITIAL_STATE: AppState = {
  view:          'home',
  wizardStep:    1,
  wizardDraft:   {},
  activeSession: null,
  tickState:     null,
  alerts:        [],
};

// ─── Actions ──────────────────────────────────────────────────────────────────
type Action =
  | { type: 'NAV'; view: AppView }
  | { type: 'WIZARD_STEP'; step: number }
  | { type: 'WIZARD_UPDATE'; patch: Partial<WizardDraft> }
  | { type: 'WIZARD_RESET' }
  | { type: 'SESSION_START'; session: Session }
  | { type: 'SESSION_UPDATE'; patch: Partial<Session> }
  | { type: 'TICK'; patch: Partial<TickState> }
  | { type: 'ALERT_ADD'; alert: AppState['alerts'][0] }
  | { type: 'ALERT_CLEAR' }
  | { type: 'SESSION_END' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'NAV':
      return { ...state, view: action.view };
    case 'WIZARD_STEP':
      return { ...state, wizardStep: action.step };
    case 'WIZARD_UPDATE':
      return { ...state, wizardDraft: { ...state.wizardDraft, ...action.patch } };
    case 'WIZARD_RESET':
      // Inietta i valori default per i campi che hanno ?? nei componenti
      // così canProceed() funziona senza che l'utente tocchi ogni campo
      return { ...state, wizardDraft: {
        totalFlourGrams:  1000,
        numPanetti:       6,
        hydration:        65,
        salt:             2.0,
        fat:              0,
        altitudeM:        0,
        waterHardnessPpm: 150,
        puntataH:         8,
        staglioH:         0.5,
        apprettoH:        4,
        tcHours:          12,
        fridgeTempC:      4,
        maltDP:           200,
        containerPreset:  'closed_box',
        apprettoProtocol: 'ta',
      }, wizardStep: 1 };
    case 'SESSION_START':
      return { ...state, activeSession: action.session, view: 'dashboard', tickState: null };
    case 'SESSION_UPDATE':
      return state.activeSession
        ? { ...state, activeSession: { ...state.activeSession, ...action.patch } }
        : state;
    case 'TICK':
      return { ...state, tickState: state.tickState ? { ...state.tickState, ...action.patch } : action.patch as TickState };
    case 'ALERT_ADD':
      return { ...state, alerts: [...state.alerts.slice(-19), action.alert] };
    case 'ALERT_CLEAR':
      return { ...state, alerts: [] };
    case 'SESSION_END':
      return { ...state, activeSession: null, tickState: null, view: 'home' };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface CtxValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppCtx = createContext<CtxValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  return <AppCtx.Provider value={{ state, dispatch }}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
