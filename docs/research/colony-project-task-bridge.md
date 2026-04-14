# Colony ↔ .project/tasks Bridge — estado atual

**Data:** 2026-04-14

## Pergunta

A colônia (`@ifi/oh-pi-ant-colony`) acessa automaticamente as tasks do `.project/tasks.json` (davidorex)?

## Resposta curta

**Não, não hoje de forma nativa.**

## Evidências práticas

1. O comando `/colony` recebe apenas `goal` no handler e dispara runtime próprio da colônia.
2. A colônia mantém armazenamento interno de tasks no nest runtime (`ant-colony/.../tasks/*.json`).
3. Não há integração direta observável com `read-block` / `write-block` / `.project/tasks.json` no código da colônia.

## Implicação

Temos dois sistemas de task em paralelo:
- `.project/tasks.json` (planejamento/governança)
- tasks internas da colônia (execução operacional do swarm)

Sem bridge, não existe sincronização automática start/progress/end.

## Estratégia recomendada

1. manter `.project/tasks` como fonte de governança macro;
2. usar runtime da colônia para execução micro;
3. criar adapter opt-in para sincronizar eventos de colônia como "candidato" em `.project/tasks`;
4. exigir revisão humana antes de fechar tasks estratégicas.

## Risco se não houver bridge

- falsa sensação de conclusão (colônia finaliza, task macro segue aberta sem contexto);
- ou fechamento manual precipitado sem evidência de custo/resultado.

## Próximo passo

Prototipar bridge incremental no `colony-pilot` sem acoplamento forte com pacotes third-party.
