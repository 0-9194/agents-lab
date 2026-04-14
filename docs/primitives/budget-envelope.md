# Primitiva: Budget Envelope

## Categoria

Avaliação / Coordenação / Planejamento

## Problema

Sistemas com múltiplos agentes (ex.: colônia/swarm) podem escalar custo rapidamente sem um contrato explícito de budget por execução.

## Definição

**Budget Envelope** = unidade de controle de custo acoplada a um objetivo de trabalho.

Estrutura mínima:
- `id`
- `goal`
- `maxCost`
- `scope` (session | colony | workflow)
- `owner`
- `status` (planned | active | completed | cancelled)
- `evidence` (usage/quota exports)
- `taskRefs` (.project/tasks)

## Invariantes

1. nenhuma execução de swarm sem budget envelope explícito;
2. toda execução gera evidência auditável (mínimo: consumo e janela);
3. fechamento de envelope exige revisão humana.

## Implementação no ecossistema atual

- live provider windows: `/usage`
- histórico local: `/session-breakdown`
- export auditável: `/quota-visibility export`
- gate de swarm: `piStack.colonyPilot.budgetPolicy` + `ant_colony.maxCost`
- gestão de trabalho: `.project/tasks.json`

## Limite conhecido atual

`/colony <goal>` não expõe `maxCost` na CLI.

Logo, para enforcement hard de custo, o caminho recomendado é o fluxo com `ant_colony` e `maxCost`.

## Próximos incrementos

1. adapter `.project tasks` ↔ lifecycle da colônia (start/progress/end);
2. resumo de budget envelope no handoff da sessão;
3. política de aprovação para exceder hardCap (human-in-the-loop);
4. roteamento para modelos locais com envelopes separados por origem de custo.
