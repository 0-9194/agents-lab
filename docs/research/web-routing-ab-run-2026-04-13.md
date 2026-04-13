---
created: 2026-04-13
status: draft
---

# Web Routing A/B — Run 2026-04-13

## Setup

- Protocolo: `docs/research/web-routing-ab-protocol.md`
- Dataset: `docs/research/data/web-routing-ab/run-2026-04-13/results.json`
- Tarefas interativas: I1–I4
- Braços:
  - **A (baseline)**
  - **B (policy-strict)** com instrução explícita para usar `web-browser` primeiro

## Métricas agregadas

| Braço | Success rate | Tempo médio (s) | CDP-path rate | Fallback rate |
|---|---:|---:|---:|---:|
| A (baseline) | 1.00 | 53.88 | 0.00 | 1.00 |
| B (policy-strict) | 1.00 | 71.21 | 1.00 | 0.00 |

## Leitura principal

1. O braço B conseguiu o que queríamos em determinismo de rota:
   - **CDP-path 100%**
   - **fallback 0%**
2. Porém, não houve ganho de sucesso (ambos 100%).
3. E houve custo de performance relevante:
   - `71.21s` vs `53.88s` (**+32.2%** de latência média no braço B).

## Gate de decisão (do protocolo)

Critérios para recomendar hard enforcement:

1. `success_rate_B >= success_rate_A + 20pp`
2. `tempo_medio_B <= tempo_medio_A * 1.10`
3. `cdp_path_rate_B >= 70%`
4. `fallback_rate_B <= 15%`

### Resultado

- C1: ❌ (1.00 vs 1.00, sem +20pp)
- C2: ❌ (+32.2% de latência, acima de +10%)
- C3: ✅ (100%)
- C4: ✅ (0%)

**Decisão sóbria:** **não ativar hard enforcement global agora**.

## Decisão operacional recomendada

- Manter **soft policy** (já documentada em `source-research` e `web-browser`).
- Aplicar **hard enforcement apenas em escopo limitado**, quando:
  - tarefa explicitamente exigir ação de UI (click/fill/login), e
  - custo de latência extra for aceitável.
- Continuar medindo em cenários com autenticação/formulário real, onde CDP tende a ter vantagem estrutural.
