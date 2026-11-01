import { describe, expect, it } from 'vitest';
import { cholesky, choleskyJitter, inverseSPD, solveLower, solveLowerT } from './linalg.ts';

const A = Float64Array.from([4, 2, 2, 3]);

describe('cholesky', () => {
  it('factors a 2×2 SPD matrix', () => {
    const L = cholesky(A, 2);
    expect(L[0]).toBeCloseTo(2);
    expect(L[1]).toBe(0);
    expect(L[2]).toBeCloseTo(1);
    expect(L[3]).toBeCloseTo(Math.SQRT2);
  });

  it('throws on non-PD input', () => {
    expect(() => cholesky(Float64Array.from([1, 2, 2, 1]), 2)).toThrow(/positive definite/);
  });

  it('choleskyJitter recovers a singular PSD matrix', () => {
    const L = choleskyJitter(Float64Array.from([1, 1, 1, 1]), 2);
    expect(Number.isFinite(L[3])).toBe(true);
  });
});

describe('triangular solves', () => {
  it('solve L x = b and Lᵀ x = b', () => {
    const L = cholesky(A, 2);
    const b = Float64Array.from([2, 5]);
    const x = solveLowerT(L, 2, solveLower(L, 2, b)); // A x = b
    expect(4 * x[0] + 2 * x[1]).toBeCloseTo(2);
    expect(2 * x[0] + 3 * x[1]).toBeCloseTo(5);
  });
});

describe('inverseSPD', () => {
  it('returns the inverse', () => {
    const inv = inverseSPD(A, 2);
    expect(4 * inv[0] + 2 * inv[2]).toBeCloseTo(1);
    expect(4 * inv[1] + 2 * inv[3]).toBeCloseTo(0);
    expect(2 * inv[0] + 3 * inv[2]).toBeCloseTo(0);
    expect(2 * inv[1] + 3 * inv[3]).toBeCloseTo(1);
  });
});
