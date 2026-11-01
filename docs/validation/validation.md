# Surrogate validation: browser Laplace vs NumPyro MCMC

MCMC: NUTS, 500 warmup + 1000 samples, 1 chain. Metrics on unobserved nodes.
NE/LE top-5 = the Laplace model's next pick is among the MCMC model's 5 best candidates. LE ρ = Spearman rank correlation of LE scores.

| scenario | obs | Laplace ms | fixed MCMC s | fixed MAE | fixed r | NE top-5 | LE top-5 | LE ρ | paper MAE | paper r | NE top-5 | LE top-5 | LE ρ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grid10/ob00/t0 | 1 | 0.04 | 3.7 | 0.009 | 0.919 | ✓ | ✓ | 1.00 | 0.014 | 0.073 | ✗ | ✓ | 0.99 |
| grid10/ob00/t5 | 6 | 0.04 | 1.5 | 0.014 | 0.988 | ✓ | ✓ | 0.95 | 0.046 | 0.591 | ✗ | ✗ | 0.72 |
| grid10/ob00/t10 | 11 | 0.09 | 1.5 | 0.016 | 0.995 | ✓ | ✓ | 0.97 | 0.078 | 0.481 | ✓ | ✗ | 0.46 |
| grid10/ob01/t0 | 1 | 0.04 | 0.7 | 0.011 | 0.944 | ✗ | ✓ | 0.99 | 0.012 | 0.318 | ✗ | ✗ | 0.99 |
| grid10/ob01/t5 | 6 | 0.08 | 0.8 | 0.015 | 0.990 | ✓ | ✗ | 0.96 | 0.049 | 0.600 | ✗ | ✗ | 0.77 |
| grid10/ob01/t10 | 11 | 0.30 | 1.2 | 0.019 | 0.996 | ✓ | ✓ | 0.94 | 0.078 | 0.784 | ✗ | ✗ | 0.52 |
| grid10/ob02/t0 | 1 | 0.02 | 0.8 | 0.016 | 0.819 | ✗ | ✗ | 0.94 | 0.019 | 0.236 | ✗ | ✓ | 0.99 |
| grid10/ob02/t5 | 6 | 0.03 | 1.0 | 0.011 | 0.986 | ✗ | ✓ | 0.95 | 0.043 | 0.540 | ✗ | ✓ | 0.90 |
| grid10/ob02/t10 | 11 | 0.08 | 0.9 | 0.016 | 0.991 | ✓ | ✓ | 0.91 | 0.059 | 0.503 | ✗ | ✓ | 0.84 |

**Mean (fixed):** MAE 0.014, r 0.959, NE top-5 67%, LE top-5 78%, LE ρ 0.96
**Mean (paper):** MAE 0.044, r 0.458, NE top-5 11%, LE top-5 44%, LE ρ 0.80
**Speed:** Laplace 0.08 ms vs MCMC 1.3 s per update
