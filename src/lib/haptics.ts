/**
 * PizzaMatrix — Haptics (feature-detected, opzionale)
 *
 * Wrapper su @capacitor/haptics. Il plugin NON è una dipendenza obbligatoria:
 * se assente (build web o plugin non installato) il try/catch lascia un no-op.
 * Su web (non-native) ritorna subito senza errori.
 */
import { Capacitor } from '@capacitor/core';

export async function haptics(style: 'Light' | 'Medium' | 'Heavy' = 'Light'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // Specifier non-letterale: tsc non risolve staticamente il modulo (resta `any`),
    // così la build non fallisce se @capacitor/haptics non è installato.
    const spec = '@capacitor/haptics';
    const mod: any = await import(/* @vite-ignore */ spec);
    const { Haptics, ImpactStyle } = mod;
    await Haptics.impact({ style: ImpactStyle[style] });
  } catch {
    /* plugin assente: no-op */
  }
}
