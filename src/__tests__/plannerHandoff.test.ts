import { describe, it, expect } from 'vitest';
import { WizardInputSchema } from '../lib/schemas';
import { canBakeNow, resolveThreshold } from '../lib/bakeReadiness';
import { matStateIndependent } from '../components/dashboard/DashboardV4';

describe('Planner → wizard', () => {
  it('lo schema accetta il piano del Servizio (temperingH, timeline, soglia)', () => {
    const r = WizardInputSchema.safeParse({
      style: 'napoletana', totalFlourGrams: 500, numPanetti: 4,
      apprettoProtocol: 'tc_appreto', temperingH: 2.4,
      thermalTimeline: [{ phaseType: 'bulk_room', startElapsedH: 0, endElapsedH: 6, status: 'current' }],
      alertThreshold: 88, navigationSource: 'planner',
    });
    expect(r.success).toBe(true);
  });
  it('rifiuta un riscaldo fuori misura', () => {
    expect(WizardInputSchema.safeParse({ totalFlourGrams: 500, numPanetti: 4, temperingH: 40 }).success).toBe(false);
  });
});

describe('soglia della sessione', () => {
  it('vince quella scelta, altrimenti lo stile', () => {
    expect(resolveThreshold(90, 80)).toBe(90);
    expect(resolveThreshold(undefined, 80)).toBe(80);
    expect(resolveThreshold(undefined, undefined)).toBe(85);
    expect(resolveThreshold(120, 80)).toBe(100);
  });
  it('con target 90, l’80% non è PRONTO', () => {
    expect(matStateIndependent(80, 90)).toBe('IN_CORSO');
    expect(matStateIndependent(82, 90)).toBe('QUASI');
    expect(matStateIndependent(91, 90)).toBe('PRONTO');
  });
});

describe('pronto = infornabile', () => {
  it('mai in frigo', () => {
    expect(canBakeNow({ phase: 'balled_fridge', tDoughC: 4, hadFridge: true })).toBe(false);
    expect(canBakeNow({ phase: 'bulk_fridge', tDoughC: 20 })).toBe(false);
  });
  it('dopo il frigo, solo col cuore a temperatura', () => {
    expect(canBakeNow({ phase: 'proofing', tDoughC: 12, hadFridge: true })).toBe(false);
    expect(canBakeNow({ phase: 'proofing', tDoughC: 19, hadFridge: true })).toBe(true);
  });
  it('senza frigo una cucina fresca non blocca il pronto', () => {
    expect(canBakeNow({ phase: 'proofing', tDoughC: 16, hadFridge: false })).toBe(true);
  });
});

describe('timeline precomputata all\'avvio', () => {
  it('il primo segmento è in corso, gli altri pianificati', async () => {
    const { normalizeTimelineStatus } = await import('../components/wizard/WizardView');
    const tl = [
      { id: 'b', phaseType: 'balled_room', startElapsedH: 1.4, endElapsedH: 1.9, ambientTempC: 22, status: 'planned' },
      { id: 'a', phaseType: 'bulk_room', startElapsedH: 0, endElapsedH: 1.4, ambientTempC: 22, status: 'planned' },
    ] as any;
    const out = normalizeTimelineStatus(tl);
    expect(out.map(s => `${s.phaseType}:${s.status}`)).toEqual(['bulk_room:current', 'balled_room:planned']);
  });
});
