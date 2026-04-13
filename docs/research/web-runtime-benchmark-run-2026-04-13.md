---
created: 2026-04-13
status: draft
---

# Web Runtime Benchmark — Run 2026-04-13 (parcial)

## Contexto do run

- Escopo: validação runtime do overlap Web da stack.
- Execução: `pi -p --no-session --mode json` com parsing de tool events.
- Artefatos:
  - `docs/research/data/web-benchmark/run-2026-04-13/results.json`
  - `docs/research/data/web-benchmark/run-2026-04-13/raw/*.log`
  - script: `scripts/benchmarks/run-web-overlap-benchmark.py`

> Nota: este run cobriu 4/6 tarefas planejadas (A1, A2, B1, C1).

## Resultados por tarefa

### A1 — quick lookup (TypeScript latest)
- Tempo até resposta útil: **36.66s**
- Tools: `web_search`
- Leitura: rota enxuta e determinística para lookup curto.

Score (1-5):
- Latência útil: 4
- Qualidade: 4
- Evidência: 4
- Ruído operacional: 5
- Determinismo de rota: 5

### A2 — quick lookup (Vite 7 changes)
- Tempo até resposta útil: **51.10s**
- Tools: `web_search`, `fetch_content`
- Leitura: lookup simples com ampliação para conteúdo (mais custo, melhor contexto).

Score (1-5):
- Latência útil: 3
- Qualidade: 4
- Evidência: 4
- Ruído operacional: 4
- Determinismo de rota: 4

### B1 — deep research (TanStack Query stale)
- Tempo até resposta útil: **153.56s**
- Tools: `fetch_content` + `bash` + `read` (ciclo de investigação em código)
- Leitura: comportamento esperado de pesquisa profunda com evidência em código.

Score (1-5):
- Latência útil: 2
- Qualidade: 4
- Evidência: 5
- Ruído operacional: 3
- Determinismo de rota: 4

### C1 — browser-ish task (npm vitest deps)
- Tempo até resposta útil: **45.23s**
- Tools: `fetch_content` (sem CDP explícito)
- Leitura: tarefa de “abrir página e extrair” foi resolvida por fetch/scrape, não por automação de navegador.

Score (1-5):
- Latência útil: 4
- Qualidade: 3
- Evidência: 4
- Ruído operacional: 4
- Determinismo de rota: 3

---

## Conclusões preliminares deste run

1. **Quick lookup converge para `web_search`** com baixa ambiguidade.
2. **Deep research converge para pipeline de código** (`fetch_content` + `bash` + `read`), consistente com `source-research`.
3. **Tarefas de “abrir página” nem sempre acionam CDP**; frequentemente resolvem via `fetch_content`.
4. Overlap Web continua mais **semântico** do que nominal; o desafio é policy de roteamento, não colisão técnica.

## Decisões parciais

- Manter direção: `source-research` como orquestração de pesquisa profunda.
- Manter `fetch_content` como base para extração web geral.
- Refinar prompt/política para forçar CDP quando a intenção exigir interação real (clique/form/navegação guiada).

## Próximo passo

Completar os 2 cenários restantes:
- B2 (deep-research #2)
- C2 (browser-automation #2)

e consolidar decisão em atualização do `overlap-matrix.md`.
