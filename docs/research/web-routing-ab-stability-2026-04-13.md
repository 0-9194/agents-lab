---
created: 2026-04-13
status: draft
---

# Web Routing A/B Stability — guardrails-core (2026-04-13)

## Contexto

Consolidação da trilha de estabilidade do taskset `cloudflare-recheck` após `guardrails-core`.

Runs considerados:
- `run-2026-04-13-guardrails-core-r1`
- `run-2026-04-13-guardrails-core-r2`
- `run-2026-04-13-guardrails-core-r3`

## Resumo por rodada

| Run | Braço A (baseline) avg s | Braço B (policy-strict) avg s | Success A/B | CDP-path A/B | Fallback A/B | Disallowed A/B |
|---|---:|---:|---|---|---|---|
| r1 | 76.42 | 72.59 | 1.00 / 1.00 | 1.00 / 1.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| r2 | 69.76 | 53.05 | 1.00 / 1.00 | 1.00 / 1.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| r3 | 47.06 | 118.75 | 1.00 / 1.00 | 1.00 / 1.00 | 0.00 / 0.00 | 0.00 / 0.00 |

## Leitura consolidada

1. **Determinismo estabilizado** (3/3):
   - CDP-path sempre em 100%
   - fallback sempre em 0%
   - comandos proibidos sempre em 0%
2. **Sucesso funcional estável** (3/3):
   - success rate 100% em todos os braços
3. **Latência com variância**:
   - r1/r2 favorecem B
   - r3 favorece A (outlier de latência no B)

## Conclusão operacional

- O critério de estabilidade de enforcement para cenário sensível (npmjs/Cloudflare-like) está **atingido em 3 rodadas** no que importa para guarda técnica: rota, fallback e bloqueios proibidos.
- Latência ainda deve ser monitorada como métrica secundária (variância entre runs), sem invalidar a decisão de hard por escopo.
