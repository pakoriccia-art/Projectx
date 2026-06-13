/**
 * PizzaMatrix — Validation Schemas (Zod v3)
 *
 * Frontiera dati: tutti gli input del wizard passano per WizardInputSchema
 * prima della costruzione della Session. Lo schema è `.strict()` per scartare
 * campi sconosciuti che potrebbero corrompere lo stato persistito.
 *
 * I limiti sono speculari ai `max` dei componenti UI (NumInput / SliderInput);
 * questo strato impedisce che valori fuori range vengano persistiti su Dexie
 * anche se l'utente dovesse aggirare i controlli HTML.
 */
import { z } from 'zod';
import { DOUGH_LIMITS } from '../constants/limits';

// ─── Enums KB §5.4 ────────────────────────────────────────────────────────────

const StyleEnum = z.enum(['napoletana', 'contemporanea', 'teglia', 'pala', 'nystyle']);
const ProtocolEnum = z.enum(['direct', 'single_pref', 'mix_advanced']);
const AgentTypeEnum = z.enum(['fresh_yeast', 'instant_dry_yeast', 'sourdough_wheat']);
const KneadingEnum = z.enum(['hand', 'spiral', 'planetary', 'diving_arm']);
const ContainerEnum = z.enum([
  'bare', 'film', 'open_box', 'glass_covered',
  'plastic_bag', 'closed_box', 'closed_box_double',
]);
const ApprettoEnum = z.enum(['ta', 'tc', 'tc_puntata', 'tc_appreto']);
const PrefermentTypeEnum = z.enum(['poolish', 'biga', 'autolysis', 'riporto']);

// ─── Sotto-schema: FlourComponent (KB §2.13) ──────────────────────────────────

const FlourComponentSchema = z.object({
  name:       z.string().max(64),
  brand:      z.string().max(64),
  W:          z.number().min(80).max(500),
  pl:         z.number().min(0.2).max(1.2),
  protein:    z.number().min(7).max(17),
  percentage: z.number().min(1).max(100),
  FN:         z.number().min(60).max(600).optional(),
  ash:        z.number().min(0.3).max(2.0).optional(),
  tipo:       z.enum(['00', '0', '1', '2', 'integrale']).optional(),
}).strict();

const FlourGroupSchema = z.object({
  flours:                z.array(FlourComponentSchema).min(1).max(3),
  effectiveW:            z.number(),
  effectivePl:           z.number(),
  effectiveProtein:      z.number(),
  effectiveAsh:          z.number(),
  effectiveAmylaseIndex: z.number(),
  isBlend:               z.boolean(),
  blendNote:             z.string().optional(),
}).strict();

// ─── Sotto-schema: Prefermento (KB §5.4, vincoli biochimici) ──────────────────

const PrefermentoComponentSchema = z.object({
  id:            z.string(),
  type:          PrefermentTypeEnum,
  flourGroup:    FlourGroupSchema,
  flourFraction: z.number().min(5).max(70),
  tempC:         z.number().min(2).max(35),
  durationH:     z.number().min(0.33).max(72),
  yeastPct:      z.number().min(0.005).max(2.0).optional(),
  hydration:     z.number().min(40).max(110),
  state:         z.object({}).passthrough().optional(),  // PrefermentoState opaco a questo livello
}).strict().superRefine((p, ctx) => {
  // KB §5.7 — vincoli per tipo (vedi validatePrefermentiMix engine-level per la versione completa)
  if (p.type === 'biga') {
    if (p.hydration < 40 || p.hydration > 55) {
      ctx.addIssue({ code: 'custom', message: 'Biga: hydration ∈ [40, 55]%' });
    }
    if (p.yeastPct == null || p.yeastPct < 0.05 || p.yeastPct > 2.0) {
      ctx.addIssue({ code: 'custom', message: 'Biga: yeastPct ∈ [0.05, 2.0]%' });
    }
  } else if (p.type === 'poolish') {
    if (Math.abs(p.hydration - 100) > 5) {
      ctx.addIssue({ code: 'custom', message: 'Poolish: hydration ≈ 100% (±5)' });
    }
    if (p.yeastPct == null || p.yeastPct < 0.05 || p.yeastPct > 1.0) {
      ctx.addIssue({ code: 'custom', message: 'Poolish: yeastPct ∈ [0.05, 1.0]%' });
    }
  } else if (p.type === 'autolysis') {
    if (p.durationH < 0.33 || p.durationH > 24) {
      ctx.addIssue({ code: 'custom', message: 'Autolisi: durationH ∈ [0.33, 24]h' });
    }
    if (p.tempC < 4 || p.tempC > 35) {
      ctx.addIssue({ code: 'custom', message: 'Autolisi: tempC ∈ [4, 35]°C' });
    }
    if (p.hydration < 50 || p.hydration > 80) {
      ctx.addIssue({ code: 'custom', message: 'Autolisi: hydration ∈ [50, 80]%' });
    }
  }
});

// ─── Schema principale input wizard ──────────────────────────────────────────

/**
 * Valida tutti i campi del WizardDraft prima che `buildSession` costruisca
 * la sessione. `.strict()` rifiuta campi sconosciuti.
 *
 * Tutti i campi opzionali hanno default applicati nel reducer WIZARD_RESET
 * (AppContext.tsx) — quando lo schema viene chiamato, sono sempre popolati.
 */
export const WizardInputSchema = z.object({
  // Step 1
  style:            StyleEnum.optional(),
  totalFlourGrams:  z.number().min(200, 'Farina minima: 200 g').max(DOUGH_LIMITS.MAX_FARINA_G, `Farina totale fuori range (max ${DOUGH_LIMITS.MAX_FARINA_G / 1000} kg)`),
  numPanetti:       z.number().int().min(1).max(DOUGH_LIMITS.MAX_PANETTI, `Numero panetti fuori range (1–${DOUGH_LIMITS.MAX_PANETTI})`),

  // Step 2
  protocol:         ProtocolEnum.optional(),

  // Step 3
  mainFlourGroup:   FlourGroupSchema.optional(),
  prefermenti:      z.array(PrefermentoComponentSchema).max(2).optional(),

  // Step 4
  hydration:        z.number().min(50).max(90).optional(),
  salt:             z.number().min(0).max(5).optional(),
  fat:              z.number().min(0).max(15).optional(),
  altitudeM:        z.number().min(0).max(5000).optional(),
  waterHardnessPpm: z.number().min(0).max(800).optional(),
  kneadingMethod:   KneadingEnum.optional(),
  kneadDurationMin: z.number().min(0).max(120).optional(),  // §2.7 v2.4.24
  tapWaterC:        z.number().min(0).max(40).optional(),   // §2.7 v2.4.24
  tLaboratorio:     z.number().min(5).max(40).optional(),

  // Step 5
  agentType:        AgentTypeEnum.optional(),
  agentDosePct:     z.number().min(0.001).max(50).optional(),
  maltDosePct:      z.number().min(0).max(3).optional(),
  maltDP:           z.number().min(50).max(500).optional(),

  // Step 6
  containerPreset:  ContainerEnum.optional(),

  // Step 7
  apprettoProtocol: ApprettoEnum.optional(),
  puntataH:         z.number().min(0).max(72).optional(),
  staglioH:         z.number().min(0).max(4).optional(),
  apprettoH:        z.number().min(0).max(72).optional(),
  tcHours:          z.number().min(0).max(120).optional(),
  fridgeTempC:      z.number().min(0).max(10).optional(),
  targetBakeAt:     z.date().optional(),

  // Service-Window planner: timeline precomputata (PhaseSegment[] opaco) + soglia bolle
  thermalTimeline:  z.array(z.object({}).passthrough()).optional(),
  bubbleThresholdPct: z.number().min(50).max(99).optional(),
  alertThreshold:   z.number().min(50).max(100).optional(),
  // Navigazione: traccia l'origine del percorso verso il riepilogo
  navigationSource: z.enum(['planner']).optional(),
}).strict();

export type WizardInput = z.infer<typeof WizardInputSchema>;
