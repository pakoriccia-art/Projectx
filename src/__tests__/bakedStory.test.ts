import { describe, it, expect } from 'vitest';
import { bakedStoryText } from '../lib/bakedStory';

const at = (hm: string) => new Date(`2026-10-05T${hm}:00`);
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('bakedStoryText', () => {
  it('senza infornata: niente', () => expect(bakedStoryText({}, clock)).toBe(''));
  it('al pronto', () => expect(bakedStoryText({ bakedAt: at('20:01'), readyAt: at('20:00') }, clock)).toBe('al pronto'));
  it('dopo il pronto', () => {
    expect(bakedStoryText({ bakedAt: at('20:45'), readyAt: at('20:00') }, clock)).toBe('45 min dopo il pronto (pronta dalle 20:00)');
  });
  it('prima del pronto previsto', () => {
    expect(bakedStoryText({ bakedAt: at('19:00'), predictedBakeAt: at('20:30') }, clock)).toBe('prima del pronto: previsto 20:30 (−1h 30m)');
    expect(bakedStoryText({ bakedAt: at('20:25'), predictedBakeAt: at('20:30') }, clock)).toBe('al pronto previsto');
  });
  it('senza previsione', () => expect(bakedStoryText({ bakedAt: at('19:00') }, clock)).toBe('prima del pronto previsto'));
});
