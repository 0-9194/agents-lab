---
created: 2026-04-13
status: draft
---

# Colony × Monitors A/B — Run 2026-04-13 (r1)

## Setup

- Script: `scripts/benchmarks/run-colony-monitor-ab.py`
- Dataset: `docs/research/data/colony-monitor-ab/run-2026-04-13-r1/results.json`
- Sandbox: cada tarefa roda em repositório git temporário mínimo
- Tarefas:
  - C1: criar `RESULT.txt`
  - C2: criar `CHECKLIST.md`

Braços:
- **A (monitors-on):** `@davidorex/pi-project-workflows/monitors-extension` + `@ifi/oh-pi-ant-colony`
- **B (monitors-off):** apenas `@ifi/oh-pi-ant-colony`

## Métricas agregadas

| Braço | Success rate | Avg elapsed (s) | Timeout rate | ant_colony call rate | Expected files rate | Monitor signal rate |
|---|---:|---:|---:|---:|---:|---:|
| A (monitors-on) | 1.00 | 312.23 | 0.00 | 1.00 | 1.00 | 0.00 |
| B (monitors-off) | 1.00 | 160.93 | 0.00 | 1.00 | 1.00 | 0.00 |

## Leitura principal

1. Ambos os braços concluíram as tarefas (2/2) com artefatos esperados criados.
2. Não houve sinais de steering de monitor (`monitor-steer`/`monitor-pending`) no run.
3. Mesmo sem steer explícito, o braço com monitores ON ficou significativamente mais lento:
   - `312.23s` vs `160.93s` (**+94%** em média).

## Implicação para pilot de colônia

- A hipótese de “mistura dentro dos ants” segue **não suportada** (consistente com evidência estática do loader mínimo).
- Há evidência pragmática de **overhead no processo principal** com monitores ON em execução de colônia.

### Recomendação provisória

Para pilot controlado de colônia:
- usar profile **monitors-off durante execução de colônia**,
- manter medição paralela de qualidade para decidir coexistência futura com custo aceitável.
