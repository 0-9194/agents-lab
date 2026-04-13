# Token Efficiency & Monitor Calibration

**Data:** 2026-04-13
**Engine:** Pi + `@davidorex/pi-project-workflows`
**Status:** Concluído

## Objetivo

Identificar e corrigir padrões de desperdício de tokens e falsos positivos nos
monitores de comportamento, validados no workspace `potlabs` e portados para
este repositório.

## Configuração

Nenhuma dependência extra. As mudanças são em arquivos de configuração do
workspace (`.pi/agents/`, `.pi/monitors/`).

## Mudanças Implementadas

### 1. Classificadores de sensor → `claude-haiku-4-5`

Todos os agentes com `role: sensor` em `.pi/agents/` foram migrados de
`github-copilot/claude-sonnet-4.6` (thinking on) para `anthropic/claude-haiku-4-5`
(thinking off).

**Justificativa:** classificadores executam em todo turno. A tarefa de
classificação binária (flag/clean) não requer raciocínio profundo — usar
Sonnet com thinking multiplicava o custo de operação sem ganho de qualidade
observável.

**Arquivos alterados:**
- `.pi/agents/hedge-classifier.agent.yaml`
- `.pi/agents/fragility-classifier.agent.yaml`
- `.pi/agents/commit-hygiene-classifier.agent.yaml`
- `.pi/agents/unauthorized-action-classifier.agent.yaml`
- `.pi/agents/work-quality-classifier.agent.yaml`

### 2. Remoção de `conversation_history` do contexto do `hedge`

O campo `conversation_history` deve ser removido de `classify.context` no
`hedge.monitor.json` (runtime em `~/.pi/monitors/hedge.monitor.json`).

```json
// Antes
"context": ["user_text", "tool_results", "tool_calls", "custom_messages",
            "assistant_text", "conversation_history"]

// Depois
"context": ["user_text", "tool_results", "tool_calls",
            "custom_messages", "assistant_text"]
```

**Problemas que isso resolve:**
1. **Custo:** histórico longo aumentava o input de tokens do classificador a cada turno
2. **Falsos positivos:** classificador interpretava "resposta curta após muitas
   tool calls" como hedge, porque via o volume de trabalho no histórico mas não
   entendia que a resposta concisa era intencional

**Como aplicar:**
```bash
# Editar diretamente o arquivo runtime
$EDITOR ~/.pi/monitors/hedge.monitor.json
# Remover "conversation_history" do array classify.context
```

### 3. Diretiva de eficiência de tokens (T1–T11)

Bloco de instrução a ser inserido **no topo** do `APPEND_SYSTEM.md` do workspace.
Ver template completo em [`../../docs/guides/token-efficiency.md`](../../docs/guides/token-efficiency.md).

**Regras:**

| # | Regra | Anti-padrão proibido |
|---|-------|----------------------|
| T1 | Ler com precisão cirúrgica — `offset`/`limit` em arquivos grandes | `read(path)` sem limite em arquivos >100 linhas desconhecidas |
| T2 | Batchear chamadas independentes | Chamadas sequenciais quando poderiam ser paralelas |
| T3 | Navegar antes de ler — `lsp_navigation` / `ast_grep_search` | `read` em arquivo inteiro para achar uma função |
| T4 | Skills lazy — só carregar quando a tarefa bater com a descrição | Carregar skills "por garantia" |
| T5 | Não repetir contexto estabelecido na sessão | `read` de arquivo já lido sem mudança |
| T6 | Respostas concisas — tabelas, listas e código > parágrafos longos | Explicações prolixas de decisões óbvias |
| T7 | `rg`/`find` antes de `read` | Abrir arquivo para descobrir se contém algo |
| T8 | Edições cirúrgicas — `edit` com `oldText` mínimo + `multi` | `write` de arquivo inteiro para alterar poucas linhas |
| T9 | Subagentes com escopo fechado — contexto compacto e específico | Passar arquivos inteiros como contexto de subagente |
| T10 | Parar ao ter resposta | Leituras extras "para garantir" após confirmação |
| T11 | Haiku para tarefas simples em paralelo | Usar Sonnet/Opus para tarefas triviais paralelizáveis |

### 4. Diretiva de segurança — proibição de `sudo` (S1–S3)

Bloco a ser inserido no `APPEND_SYSTEM.md` após a diretiva de tokens.
Ver template completo em [`../../docs/guides/token-efficiency.md`](../../docs/guides/token-efficiency.md).

| # | Regra | Anti-padrão proibido |
|---|-------|----------------------|
| S1 | Nunca usar `sudo` | `sudo apt install`, `sudo systemctl`, `sudo chmod` |
| S2 | Scripts gerados sem `sudo` | Adicionar `sudo` "para garantir" |
| S3 | Sugerir alternativas sem privilégio | Omitir silenciosamente operações que requerem sudo |

### 5. Recalibração de padrões aprendidos

Padrões com `"source": "learned"` nos arquivos `*.patterns.json` (runtime em
`~/.pi/monitors/`) devem ser revisados periodicamente.

**Problema identificado no workspace `potlabs`:** o monitor `hedge` aprendeu
um padrão que generalizou incorretamente — qualquer resposta curta após muitas
tool calls era interpretada como hedge, gerando 4+ falsos positivos consecutivos.

**Recomendação para o pacote:** adicionar campo `reviewed_at` nos padrões
aprendidos e alertar quando padrões não revisados excedem N dias. Isso está
registrado como melhoria sugerida para `@davidorex/pi-behavior-monitors`.

## Resultados

- Redução de custo por turno nos monitores (Haiku vs Sonnet + thinking)
- Eliminação de falsos positivos do `hedge` causados por `conversation_history`
- Diretivas T1–T11 e S1–S3 documentadas para reuso em outros workspaces

## Conclusões

**Regra geral extraída:** agentes com `role: sensor` devem usar por padrão o
modelo mais leve disponível. O contexto de classificadores de monitor não deve
incluir `conversation_history` — adiciona ruído e custo sem benefício observável.

**Primitiva candidata:** uma skill `calibrate-monitors` que automatize a
aplicação dessas mudanças em qualquer workspace poderia ser promovida para
`@aretw0/lab-skills` ou `@davidorex/pi-behavior-monitors`.
