# Surrogate validation: browser Laplace vs NumPyro MCMC

MCMC: NUTS, 500 warmup + 1000 samples, 1 chain. Metrics on unobserved nodes.
NE/LE top-5 = the Laplace model's next pick is among the MCMC model's 5 best candidates. LE ρ = Spearman rank correlation of LE scores.

| scenario | obs | Laplace ms | fixed MCMC s | fixed MAE | fixed r | NE top-5 | LE top-5 | LE ρ | paper MAE | paper r | NE top-5 | LE top-5 | LE ρ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grid10/ob00/t0 | 1 | 0.03 | 3.6 | 0.013 | 0.932 | ✗ | ✓ | 1.00 | 0.017 | 0.077 | ✗ | ✓ | 0.99 |
| grid10/ob00/t10 | 11 | 0.08 | 1.5 | 0.053 | 0.995 | ✓ | ✓ | 0.93 | 0.094 | 0.664 | ✗ | ✗ | 0.30 |
| grid10/ob00/t20 | 21 | 0.15 | 1.7 | 0.062 | 0.999 | ✓ | ✓ | 0.92 | 0.134 | 0.699 | ✗ | ✗ | 0.14 |
| grid10/ob01/t0 | 1 | 0.05 | 0.9 | 0.015 | 0.944 | ✗ | ✓ | 0.99 | 0.013 | 0.321 | ✗ | ✗ | 0.99 |
| grid10/ob01/t10 | 11 | 0.16 | 0.9 | 0.044 | 0.997 | ✓ | ✓ | 0.94 | 0.088 | 0.757 | ✗ | ✓ | 0.83 |
| grid10/ob01/t20 | 21 | 0.31 | 0.9 | 0.069 | 0.998 | ✓ | ✓ | 0.87 | 0.136 | 0.919 | ✗ | ✗ | 0.26 |
| grid10/ob02/t0 | 1 | 0.02 | 0.9 | 0.018 | 0.905 | ✗ | ✓ | 0.99 | 0.023 | 0.242 | ✗ | ✓ | 0.99 |
| grid10/ob02/t10 | 11 | 0.08 | 0.8 | 0.024 | 0.994 | ✓ | ✓ | 0.98 | 0.070 | 0.533 | ✗ | ✓ | 0.73 |
| grid10/ob02/t20 | 21 | 0.14 | 0.8 | 0.053 | 0.997 | ✓ | ✗ | 0.72 | 0.105 | 0.763 | ✗ | ✗ | 0.65 |

**Mean (fixed):** MAE 0.039, r 0.973, NE top-5 67%, LE top-5 89%, LE ρ 0.93
**Mean (paper):** MAE 0.075, r 0.553, NE top-5 0%, LE top-5 44%, LE ρ 0.65
**Speed:** Laplace 0.11 ms vs MCMC 1.3 s per update
