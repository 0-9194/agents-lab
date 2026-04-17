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
