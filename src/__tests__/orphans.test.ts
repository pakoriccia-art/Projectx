import { describe, it, expect } from 'vitest';
import { classifyOrphans } from '../lib/orphans';

const NOW = new Date('2026-10-05T12:00:00').getTime();
const H = 3_600_000;
const at = (h: number) => new Date(NOW - h * H);

describe('classifyOrphans', () => {
  it('doppione del vecchio bug (gemello completed) → eliminato', () => {
    const rows = [
      { id: 1, status: 'active', startedAt: at(30) },
      { id: 2, status: 'completed', startedAt: new Date(at(30).getTime() + 400) },
    ];
    expect(classifyOrphans(rows, NOW)).toEqual({ remove: [1], abort: [] });
  });
  it('mai chiusa e senza gemello → interrotta', () => {
    expect(classifyOrphans([{ id: 3, status: 'active', startedAt: at(5) }], NOW)).toEqual({ remove: [], abort: [3] });
  });
  it('sessione viva con fotografia → intatta', () => {
    expect(classifyOrphans([{ id: 4, status: 'active', startedAt: at(5), lastTickState: {} }], NOW)).toEqual({ remove: [], abort: [] });
  });
  it('con fotografia ma più vecchia di 72 h → orfana', () => {
    expect(classifyOrphans([{ id: 5, status: 'active', startedAt: at(80), lastTickState: {} }], NOW)).toEqual({ remove: [], abort: [5] });
  });
  it('la sessione in ripresa non si tocca mai', () => {
    expect(classifyOrphans([{ id: 6, status: 'active', startedAt: at(80) }], NOW, 6)).toEqual({ remove: [], abort: [] });
  });
  it('completed e aborted non sono orfane', () => {
    expect(classifyOrphans([{ id: 7, status: 'completed', startedAt: at(2) }, { id: 8, status: 'aborted', startedAt: at(2) }], NOW))
      .toEqual({ remove: [], abort: [] });
  });
});
