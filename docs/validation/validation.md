# Surrogate validation: browser Laplace vs NumPyro MCMC

MCMC: NUTS, 500 warmup + 1000 samples, 1 chain. Metrics on unobserved nodes.
NE/LE top-5 = the Laplace model's next pick is among the MCMC model's 5 best candidates. LE ρ = Spearman rank correlation of LE scores.

| scenario | obs | Laplace ms | fixed MCMC s | fixed MAE | fixed r | NE top-5 | LE top-5 | LE ρ | paper MAE | paper r | NE top-5 | LE top-5 | LE ρ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| grid10/ob00/t0 | 1 | 0.16 | 3.3 | 0.010 | 0.912 | ✓ | ✓ | 1.00 | 0.011 | 0.091 | ✗ | ✓ | 0.99 |
| grid10/ob00/t10 | 11 | 0.10 | 1.4 | 0.035 | 0.995 | ✓ | ✓ | 0.95 | 0.068 | 0.720 | ✗ | ✗ | 0.73 |
| grid10/ob00/t20 | 21 | 0.15 | 1.4 | 0.050 | 0.997 | ✓ | ✓ | 0.92 | 0.109 | 0.779 | ✓ | ✓ | 0.81 |
| grid10/ob01/t0 | 1 | 0.11 | 0.8 | 0.011 | 0.935 | ✗ | ✓ | 1.00 | 0.008 | 0.323 | ✗ | ✗ | 0.99 |
| grid10/ob01/t10 | 11 | 0.09 | 0.7 | 0.034 | 0.995 | ✓ | ✓ | 0.98 | 0.066 | 0.795 | ✓ | ✓ | 0.84 |
| grid10/ob01/t20 | 21 | 0.19 | 0.7 | 0.053 | 0.998 | ✓ | ✓ | 0.95 | 0.097 | 0.912 | ✗ | ✓ | 0.82 |
| grid10/ob02/t0 | 1 | 0.02 | 0.7 | 0.013 | 0.887 | ✗ | ✓ | 1.00 | 0.015 | 0.269 | ✗ | ✓ | 0.99 |
| grid10/ob02/t10 | 11 | 0.08 | 0.8 | 0.019 | 0.993 | ✓ | ✓ | 0.99 | 0.054 | 0.656 | ✗ | ✓ | 0.78 |
| grid10/ob02/t20 | 21 | 0.15 | 0.7 | 0.043 | 0.997 | ✓ | ✗ | 0.75 | 0.092 | 0.756 | ✗ | ✓ | 0.67 |

**Mean (fixed):** MAE 0.030, r 0.968, NE top-5 78%, LE top-5 89%, LE ρ 0.95
**Mean (paper):** MAE 0.058, r 0.589, NE top-5 22%, LE top-5 78%, LE ρ 0.85
**Speed:** Laplace 0.12 ms vs MCMC 1.2 s per update
