import { describe, it, expect, beforeEach } from 'vitest';
import { getPref, setPref } from '../lib/prefs';

describe('prefs', () => {
  beforeEach(() => localStorage.clear());
  it('scrive e rilegge', () => {
    setPref('ovenProfile', { archetipo: 'legna_prof', dualZone: true });
    expect(getPref('ovenProfile', null)).toEqual({ archetipo: 'legna_prof', dualZone: true });
  });
  it('assente o rotta: il default', () => {
    expect(getPref('nulla', 3)).toBe(3);
    localStorage.setItem('pm-prefs:rotta', '{non json');
    expect(getPref('rotta', 'x')).toBe('x');
  });
});
