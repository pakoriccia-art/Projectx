/**
 * PizzaMatrix — Validation Schemas (Zod v3)
 *
 * Impone vincoli numerici rigorosi sugli input del wizard prima della
 * creazione della sessione. I limiti sono speculari ai `max` dei componenti
 * UI (NumInput / SliderInput), ma questo strato li valida a livello dati,
 * impedendo che valori fuori range vengano persistiti su Dexie anche se
 * l'utente dovesse aggirare i controlli HTML.
 *
 * Espansione futura: aggiungere ulteriori sotto-schema per FlourComponent,
 * PrefermentoComponent e Session quando sarà necessaria la validazione
 * server-side o via API.
 */
import { z } from 'zod';

// ─── Schema principale input wizard ──────────────────────────────────────────

/**
 * Valida i campi critici del WizardDraft prima che `buildSession` costruisca
 * la sessione. Tutti gli altri campi facoltativi sono gestiti dai controlli
 * UI; questo schema funge da guardia di last resort.
 */
export const WizardInputSchema = z.object({
  /**
   * Peso totale della farina [g].
   * Limite massimo: 13.000 g ≈ 21,7 kg di impasto a 65% idratazione + 2% sale.
   */
  totalFlourGrams: z
    .number({ required_error: 'Il peso della farina è obbligatorio' })
    .min(200,    'Farina minima: 200 g')
    .max(13_000, 'Farina massima: 13.000 g'),

  /**
   * Numero di panetti [1–100].
   */
  numPanetti: z
    .number({ required_error: 'Il numero di panetti è obbligatorio' })
    .int()
    .min(1,   'Almeno 1 panetto')
    .max(100, 'Massimo 100 panetti'),
});

export type WizardInput = z.infer<typeof WizardInputSchema>;
