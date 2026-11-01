import { describe, expect, it } from 'vitest';
import { predictionColor, relativeScale, ringStyle } from './scales.ts';

describe('predictionColor', () => {
  it('is white at 0.5 and saturates at the stretch limits', () => {
    expect(predictionColor(0.5)).toBe('rgb(255,255,255)');
    expect(predictionColor(0.65)).toBe('rgb(229,115,115)');
    expect(predictionColor(0.99)).toBe('rgb(229,115,115)');
    expect(predictionColor(0.35)).toBe('rgb(100,160,225)');
    expect(predictionColor(0.0)).toBe('rgb(100,160,225)');
  });
});

describe('relativeScale', () => {
  it('min–max scales the chosen nodes only', () => {
    const r = relativeScale([0.2, 0.4, 0.3, 9], [0, 1, 2]);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(1);
    expect(r[2]).toBeCloseTo(0.5, 12);
    expect(r[3]).toBe(0); // not in `nodes`
  });

  it('returns zeros (not NaN) when values are all equal or no nodes are given', () => {
    expect(Array.from(relativeScale([0.3, 0.3], [0, 1]))).toEqual([0, 0]);
    expect(Array.from(relativeScale([0.3, 0.4], []))).toEqual([0, 0]);
  });
});

describe('ringStyle', () => {
  it('grows from thin and faint to thick and strong', () => {
    expect(ringStyle(0)).toEqual({ width: 0.5, opacity: 0.25 });
    expect(ringStyle(1).width).toBeCloseTo(5.5);
    expect(ringStyle(1).opacity).toBeCloseTo(0.95);
  });
});
