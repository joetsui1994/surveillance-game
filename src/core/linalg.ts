// Dense row-major linear algebra on Float64Array. Matrices are n×n unless stated.

export function cholesky(A: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (!(s > 0)) throw new Error(`cholesky: matrix not positive definite (pivot ${i})`);
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  return L;
}

/** Cholesky with escalating diagonal jitter for nearly-singular matrices. */
export function choleskyJitter(A: Float64Array, n: number): Float64Array {
  let jitter = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (jitter === 0) return cholesky(A, n);
      const B = A.slice();
      for (let i = 0; i < n; i++) B[i * n + i] += jitter;
      return cholesky(B, n);
    } catch {
      jitter = jitter === 0 ? 1e-10 : jitter * 100;
    }
  }
  throw new Error('choleskyJitter: failed after jitter 1e0');
}

/** Solve L x = b for lower-triangular L. */
export function solveLower(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Solve Lᵀ x = b for lower-triangular L. */
export function solveLowerT(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Inverse of a symmetric positive-definite matrix. */
export function inverseSPD(A: Float64Array, n: number): Float64Array {
  const L = choleskyJitter(A, n);
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = solveLowerT(L, n, solveLower(L, n, e));
    for (let i = 0; i < n; i++) inv[i * n + j] = col[i];
  }
  return inv;
}
