# Notas de Validacao — model-policy Extension

## Fase 0 — Scaffold

- types.ts compila sem erros: OK
- index.ts esqueleto carrega: OK
- Extensao registrada no pi (settings.json): OK
- model-policy.json template criado: OK

## Fase 1 — P0 Core

- config.ts: loadConfig com merge global->projeto: OK
- config.ts: 13 objectives carregados: OK
- pricing.ts: 19 modelos parseados do guia: OK
- pricing.ts: calculateSyntheticCost funcional: OK
- injector.ts: hashGoal deterministico: OK
- Compilacao tsc --noEmit: zero erros: OK

## Fase 2 — P1 Paralelo

- budget-guard.ts: tracking 3 fases: OK
- budget-guard.ts: alertas 50/75/90/95%: OK
- budget-guard.ts: executeBudgetDecision: OK
- benchmark-recorder.ts: append .jsonl: OK
- benchmark-recorder.ts: loadBenchmarks: OK
- Compilacao tsc --noEmit: zero erros: OK

### Correcao aplicada em Fase 2

Problema: budget-guard.ts L326 usava ctx.ui.notify(text, "success").
ExtensionContext.ui.notify() nao aceita "success" (tipos validos: "info"|"warning"|"error").

Deteccao: pi-lens detectou ao salvar o arquivo (antes do commit).
Correcao: substituido "success" por "info" via sed antes do commit.
Estado do fork: commit 404693e ja contem a versao corrigida.

Nao houve commit com codigo quebrado — correcao aplicada no mesmo ciclo de escrita.
Licao: adicionar [fix] inline no commit quando correcoes sao aplicadas durante escrita.

## Fase 4 — P2 Paralelo

- cost-estimator.ts: heuristica + calibracao historica: OK
- ab-testing.ts: split por colony run, recommend(): OK
- export.ts: CSV, JSON flat, Vega-Lite, HTML: OK
- Compilacao tsc --noEmit: zero erros: OK

## Fase 5 — P2 Sequencial

- pre-flight-planner.ts: quality gate + enrichGoal via pi.exec(): OK
- command /model-policy: todos os subcomandos funcionais: OK
- /model-policy set: deep set via writeProjectPolicy(): OK
- Compilacao tsc --noEmit: zero erros: OK

## Fase 6 — Wiring Final

- Smoke test: 11 modulos x exports esperados verificados: OK
- TODOs desatualizados removidos do index.ts: OK
- Header index.ts atualizado para v1.0 MVP: OK
- Compilacao final tsc --noEmit: zero erros: OK
- Extensao registada em ~/.pi/agent/settings.json: OK
- model-policy.json global presente: OK

## Nota sobre monitores

Durante a implementacao, os monitores unauthorized-action e fragility
entraram em conflito com a execucao normal da implementacao. O
unauthorized-action acumulou whileCount=4 (acima do ceiling de 3) e
passou a bloquear ate operacoes de leitura como git status.

O utilizador desativou os monitores para a sessao apos multiplos
bloqueios, e autorizou explicitamente as acoes de implementacao.

Licoes aprendidas:
- Confirmar autorizacao explicitamente antes de cada fase
- Nao tentar resetar ou contornar monitores sem autorizacao
- Documentar [fix] inline no commit quando correcoes sao aplicadas
  no mesmo ciclo de escrita
