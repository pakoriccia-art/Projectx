/**
 * PizzaMatrix Engine — TypeScript re-export + tipi
 * Wrappa engine-v2.4.0.js (pure JS) con types per l'app React/TypeScript
 */

// Re-export tutto dall'engine JS
export * from '../../engine/engine-v2.4.0.js';

// ─── Tipi TypeScript per le funzioni principali ──────────────────────────────

export type AgentType = 'fresh_yeast' | 'instant_dry_yeast' | 'sourdough_wheat';
export type ContainerPreset = 'bare' | 'film' | 'open_box' | 'glass_covered' | 'plastic_bag' | 'closed_box' | 'closed_box_double';
export type StructuralStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'COLLAPSED';
export type MaltAlertLevel = 'OK' | 'ADVISORY' | 'CRITICAL' | 'BLOCKED';
export type DoughPhase = 'bulk_room' | 'bulk_fridge' | 'balled_room' | 'balled_fridge' | 'proofing' | 'baking';
export type PrefermType = 'poolish' | 'biga' | 'autolysis';

export interface DashboardWResult {
  W_current:        number;
  W_initial:        number;
  decayPct:         number;
  tRatio:           number;
  tCritHours:       number;
  structuralStatus: StructuralStatus;
  breakdown: {
    prefermenti: Array<{
      id:        string;
      type:      PrefermType;
      fraction:  number;
      W_initial: number;
      label:     string;
    }>;
    rinfresco: {
      fraction:  number;
      W_initial: number;
    };
  };
}

export interface CombinedInitialState {
  effectiveW_initial:      number;
  effectivePl_initial:     number;
  effectiveProtein:        number;
  effectiveAsh:            number;
  effectiveAmylaseIndex:   number;
  initialMaturationOffset: number;
  initialPH:               number;
  rinfrescoFraction:       number;
  breakdown: {
    prefermenti: Array<{
      id:                  string;
      type:                PrefermType;
      fraction:            number;
      W_contrib:           number;
      pl_contrib:          number;
      protein_contrib:     number;
      ash_contrib:         number;
      amylase_contrib:     number;
      denaturation_factor: number;
      mat_contrib:         number;
      pH:                  number;
    }>;
    rinfresco: {
      fraction:        number;
      W_contrib:       number;
      pl_contrib:      number;
      protein_contrib: number;
      ash_contrib:     number;
      amylase_contrib: number;
      pH:              number;
    };
  };
}

export interface ReverseScalingResult {
  totalFlourKg:     number;
  rinfrescoFlourKg: number;
  rinfrescoWaterKg: number;
  totalDoughKg:     number;
  numPanetti:       number;
  panWeight:        number;
  prefermType:      PrefermType;
}

export interface SweetSpotResult {
  status:           'upcoming' | 'past_peak';
  hoursUntilPeak:   number;
  peakPct:          number;
}
