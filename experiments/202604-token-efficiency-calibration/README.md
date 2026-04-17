# Token Efficiency & Monitor Calibration

**Data:** 2026-04-13  
**Engine:** Pi + `@davidorex/pi-project-workflows` + `@aretw0/pi-stack`  
**Status:** Concluído

## Objetivo

Preservar e consolidar os achados de uma PR fechada de fork sobre:

1. redução de consumo de tokens em monitores;
2. redução de falsos positivos do monitor `hedge`;
3. regras operacionais reutilizáveis para outros workspaces.

Referência de origem: PR fechada `#5` (fork) — documentação portada para este repositório.

## Configuração

Sem dependências extras. O experimento atua em configuração de workspace e documentação.

## Mudanças validadas

### 1) Sensores em modelo leve

Agentes com `role: sensor` devem usar modelo leve com provider explícito e `thinking: "off"`, porque executam em todo turno.

Exemplo aplicado/curado na stack:

```yaml
model: github-copilot/claude-haiku-4.5
thinking: "off"
```

### 2) Hedge sem `conversation_history` por padrão

No monitor hedge do davidorex, `conversation_history` aparece em `classify.context`:

```json
// Antes
"context": ["user_text", "tool_results", "tool_calls", "custom_messages", "assistant_text", "conversation_history"]

// Depois
"context": ["user_text", "tool_results", "tool_calls", "custom_messages", "assistant_text"]
```

Impacto observado:
- menor custo por turno no classificador;
- redução de ruído contextual;
- menos falso positivo de hedge quando há resposta curta após sequência intensa de tools.

### 3) Diretivas operacionais reaproveitáveis

Foram formalizadas diretivas de eficiência (T1–T11) e segurança (S1–S3) no guia:

- [`docs/guides/token-efficiency.md`](../../docs/guides/token-efficiency.md)

## Evidências incorporadas no código

Além da documentação, o cenário de primeiro hatch foi coberto por testes no `pi-stack`:

- remoção de `conversation_history` em `classify.context` (formato davidorex);
- comportamento opt-in para reativar histórico;
- fluxo de `session_start` validando patch do hedge + criação condicional de overrides por provider.

Arquivo de testes:
- `packages/pi-stack/test/monitor-provider-patch.test.mjs`

## Resultados

- conhecimento do fork não foi perdido;
- documentação ficou rastreável no histórico principal;
- regras de custo/qualidade para monitores ficaram explícitas e reutilizáveis;
- cobertura de testes protege regressão no cenário de primeiro hatch.

## Conclusões

O trabalho do fork vira ativo do projeto quando:

1. vira guia operacional;
2. vira experimento com contexto e racional;
3. vira teste de regressão executável.

Próximo passo sugerido: promover esse pacote de práticas para uma primitiva reutilizável (`skill` ou extensão de calibração).
