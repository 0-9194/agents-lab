---
created: 2026-04-13
status: draft
---

# Web Runtime Benchmark Plan

## Objetivo

Validar em runtime se os overlaps Web observados por leitura estática geram:

1. ganho real de cobertura, ou
2. ambiguidade/ruta errática do agente.

## Ambiente de teste

- Projeto: `agents-lab`
- Instância: pi com third-party ativa via `@aretw0/pi-stack`
- Modo: preferencialmente `--local` para não contaminar setup global

## Cenários (6 tarefas canônicas)

## A) Quick lookup (2)

1. "Qual a versão estável mais recente do TypeScript e data de release?"
2. "Resumo em 5 bullets das mudanças do Vite 7"

Expectativa:
- resposta rápida,
- links canônicos,
- baixa latência e baixo ruído.

## B) Deep research (2)

3. "Como o TanStack Query decide stale state internamente? Traga permalink"
4. "No Next.js App Router, onde ocorre a validação de cache tags? Cite arquivo e linhas"

Expectativa:
- uso de `fetch_content`/pesquisa em repo,
- evidência com permalink,
- explicação verificável.

## C) Browser automation (2)

5. "Abra a página do npm do pacote X e extraia dependências"
6. "Navegue até docs de Y, clique no guia Z e traga resumo"

Expectativa:
- execução via `web-browser` (CDP),
- sequência de ações estável,
- sem fallback desnecessário para scraping textual.

## Rubrica de avaliação (1-5)

| Métrica | Descrição |
|---|---|
| Latência útil | tempo até primeira resposta útil |
| Qualidade | precisão factual e completude |
| Evidência | presença de URLs/permalinks verificáveis |
| Ruído operacional | tentativas inúteis, erros, retrabalho |
| Determinismo de rota | consistência da escolha de ferramentas |

## Template de resultado por tarefa

```md
### Tarefa N
- Prompt:
- Ferramentas/skills acionadas:
- Tempo até resposta útil:
- Score (1-5): latência / qualidade / evidência / ruído / determinismo
- Observações:
- Decisão: manter | filtrar | migrar | consolidar
```

## Critério de decisão pós-benchmark

- Se quick lookup performar melhor com skill simples e sem degradar qualidade: manter fallback explícito.
- Se houver oscilação frequente entre rotas sem ganho de qualidade: filtrar uma das rotas no installer.
- Se deep research convergir sempre para o mesmo padrão (`source-research` + `pi-web-access`): consolidar isso como política oficial da stack.
