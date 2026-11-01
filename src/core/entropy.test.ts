import { describe, expect, it } from 'vitest';
import { baldScore, binaryEntropy, probabilityStd } from './entropy.ts';
import { makeRng } from './rng.ts';

describe('binaryEntropy', () => {
  it('is ln 2 at p = 0.5, symmetric, and finite at the boundaries', () => {
    expect(binaryEntropy(0.5)).toBeCloseTo(Math.LN2);
    expect(binaryEntropy(0.2)).toBeCloseTo(binaryEntropy(0.8));
    expect(binaryEntropy(0)).toBeGreaterThan(0);
    expect(binaryEntropy(0)).toBeLessThan(1e-4);
    expect(binaryEntropy(1)).toBeCloseTo(binaryEntropy(0));
  });
});

describe('baldScore', () => {
  it('is zero with no latent uncertainty', () => {
    expect(baldScore(0.7, 0)).toBeCloseTo(0, 12);
  });

  it('grows with latent variance at mean 0', () => {
    expect(baldScore(0, 1)).toBeGreaterThan(baldScore(0, 0.5));
    expect(baldScore(0, 4)).toBeGreaterThan(baldScore(0, 1));
  });

  it('agrees with a Monte Carlo estimate', () => {
    const rng = makeRng(123);
    const [mu, v, S] = [0.8, 1.5, 200_000];
    let pBar = 0;
    let expH = 0;
    for (let s = 0; s < S; s++) {
      const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); // Box–Muller
      const p = 1 / (1 + Math.exp(-(mu + Math.sqrt(v) * z)));
      pBar += p / S;
      expH += binaryEntropy(p) / S;
    }
    expect(baldScore(mu, v)).toBeCloseTo(binaryEntropy(pBar) - expH, 3);
  });
});

describe('probabilityStd', () => {
  it('is zero with no latent uncertainty', () => {
    expect(probabilityStd(0.3, 0)).toBeCloseTo(0, 12);
  });

  it('is symmetric in the latent mean', () => {
    expect(probabilityStd(1.2, 2)).toBeCloseTo(probabilityStd(-1.2, 2), 12);
  });

  it('agrees with a Monte Carlo estimate', () => {
    const rng = makeRng(321);
    const [mu, v, S] = [0.4, 3, 200_000];
    let m1 = 0;
    let m2 = 0;
    for (let s = 0; s < S; s++) {
      const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); // Box–Muller
      const p = 1 / (1 + Math.exp(-(mu + Math.sqrt(v) * z)));
      m1 += p / S;
      m2 += (p * p) / S;
    }
    expect(probabilityStd(mu, v)).toBeCloseTo(Math.sqrt(m2 - m1 * m1), 3);
  });
});
