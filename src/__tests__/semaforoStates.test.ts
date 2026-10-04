/**
 * Stati di presentazione del semaforo di maturazione (critique impeccable):
 * "pronto" non deve condividere colore/etichetta con "in corso", e
 * l'avvicinamento non deve usare il giallo riservato ai problemi strutturali.
 */
import { describe, it, expect } from 'vitest';
import { matSemaforoFromLevel, matStateIndependent } from '../components/dashboard/DashboardV4';
import { SEMAFORO_COLORS } from '../components/dashboard/SemaforoCard';

describe('matSemaforoFromLevel', () => {
  it('mappa i livelli di maturazione su IN_CORSO / QUASI / PRONTO', () => {
    expect(matSemaforoFromLevel('OK', 10, 80)).toBe('IN_CORSO');
    expect(matSemaforoFromLevel('APPROACHING', 74, 80)).toBe('QUASI');
    expect(matSemaforoFromLevel('SWEET_SPOT', 82, 80)).toBe('PRONTO');
  });
  it('lascia i livelli strutturali ai rispettivi stati', () => {
    expect(matSemaforoFromLevel('STRUCTURAL_WARNING', 50, 80)).toBe('WARNING');
    expect(matSemaforoFromLevel('STRUCTURAL_CRITICAL', 50, 80)).toBe('CRITICAL');
    expect(matSemaforoFromLevel('STRUCTURAL_COLLAPSED', 50, 80)).toBe('COLLAPSED');
  });
  it('PRONTO, QUASI e WARNING hanno colori distinti', () => {
    const c = new Set([SEMAFORO_COLORS.PRONTO, SEMAFORO_COLORS.QUASI, SEMAFORO_COLORS.WARNING, SEMAFORO_COLORS.IN_CORSO]);
    expect(c.size).toBe(4);
  });
});

describe('matStateIndependent (stili dual)', () => {
  it('soglia raggiunta → PRONTO, ≥90% → QUASI, altrimenti IN_CORSO', () => {
    expect(matStateIndependent(85, 80)).toBe('PRONTO');
    expect(matStateIndependent(73, 80)).toBe('QUASI');
    expect(matStateIndependent(20, 80)).toBe('IN_CORSO');
  });
});
