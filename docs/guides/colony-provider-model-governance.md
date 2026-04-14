# Governança de Provider/Modelo para Colônia e Multi-Agentes

Guia para reduzir fricção ao usar `ant_colony` com múltiplos providers (Copilot/Codex/etc.) no `@aretw0/pi-stack`.

## Objetivo

Garantir que o uso de multi-agentes fique previsível para:

- **usuários da stack** (rodar colônia sem travar por config oculta)
- **devs do agents-lab** (evoluir para primitivas first-party sem lock-in)

---

## Superfícies de configuração (quem controla o quê)

| Superfície | Onde configurar | Impacto |
|---|---|---|
| Sessão principal | `defaultProvider` / `defaultModel` em settings | Modelo usado pela sessão atual do pi |
| Classifiers de monitor | `piStack.monitorProviderPatch.*` + `/monitor-provider` | Saúde dos monitores (`hedge`, `fragility`, etc.) |
| Colônia (`ant_colony`) | modelo atual da sessão + overrides por caste | Scout/worker/soldier e classes específicas |
| Governança de execução da colônia | `piStack.colonyPilot.preflight.*` + `/colony-pilot` | Gate de capacidades/executáveis antes de rodar |
| Governança de orçamento da colônia | `piStack.colonyPilot.budgetPolicy.*` + `/colony-pilot` | Exigir/injetar `maxCost`, cap de custo e mínimo operacional |

---

## Estado atual no agents-lab

### 1) Monitores (davidorex)

Resolvido com patch provider-aware:

- `monitor-provider-patch`
- comando `/monitor-provider status|apply|template`
- defaults por provider (Copilot/Codex)

### 2) Colônia (`@ifi/oh-pi-ant-colony`)

Comportamento importante:

- `ant_colony` usa **modelo atual da sessão** por padrão (`provider/model` completo)
- pode receber overrides por papel:
  - `scoutModel`, `workerModel`, `soldierModel`
  - `designWorkerModel`, `multimodalWorkerModel`, `backendWorkerModel`, `reviewWorkerModel`

### 3) Pilot de orquestração (`colony-pilot` first-party)

`/colony-pilot check` agora cobre:

- capacidades carregadas (`/monitors`, `/colony`, `/colony-stop`, `/session-web`)
- readiness de provider/model (modelo atual + `defaultProvider/defaultModel`)
- avaliação da **model policy** por classe (queen/scout/worker/soldier/design/multimodal/backend/review)
- avaliação da **budget policy** (`maxCost`, hard cap, mínimo) para `ant_colony`

> Convenção: `/doctor` é saúde global. `/colony-pilot` e `/monitor-provider` são diagnósticos de domínio.

---

## Modelos recomendados (baseline prático)

### Perfil Copilot

- scout: `github-copilot/claude-haiku-4.5`
- worker: `github-copilot/claude-sonnet-4.6`
- soldier: `github-copilot/claude-sonnet-4.6`

### Perfil Codex

- scout: `openai-codex/gpt-5.4-mini`
- worker: `openai-codex/gpt-5.3-codex`
- soldier: `openai-codex/gpt-5.2-codex`

> Heurística: scout mais barato/rápido, worker/soldier mais fortes.

---

## Checklist operacional (usuário pi-stack)

1. `/doctor` (saúde global)
2. `/monitor-provider status`
3. `/monitor-provider apply` (se houver drift)
4. `/colony-pilot models status`
5. `/colony-pilot check`
6. `/colony-pilot preflight`
7. rodar colônia com budget explícito (`ant_colony` com `maxCost`)
8. monitorar janela/limite com `/usage` + histórico com `/quota-visibility windows`

Se quiser observabilidade web local:

- `/session-web start`
- `/colony-pilot status`

### Perfis rápidos de model policy

- `/colony-pilot models template codex`
- `/colony-pilot models apply codex`
- `/colony-pilot models apply copilot`
- `/colony-pilot models apply hybrid`
- `/colony-pilot models apply factory-strict`

Esses perfis escrevem `piStack.colonyPilot.modelPolicy` no `.pi/settings.json` e ativam hard-gate no `tool_call` de `ant_colony`.

A baseline também pode configurar `piStack.colonyPilot.budgetPolicy` para exigir/injetar `maxCost` e bloquear caps acima do limite definido.

`factory-strict` é o perfil mais rígido para fábrica de agentes:
- exige modelos explícitos para todas as classes (scout/worker/soldier/design/multimodal/backend/review)
- bloqueia mistura de providers
- exige referência completa `provider/model`

---

## Exemplo de `ant_colony` com overrides explícitos

```json
{
  "goal": "Refatorar módulo X com testes",
  "maxAnts": 3,
  "maxCost": 2,
  "scoutModel": "openai-codex/gpt-5.4-mini",
  "workerModel": "openai-codex/gpt-5.3-codex",
  "soldierModel": "openai-codex/gpt-5.2-codex"
}
```

---

## Diretrizes para devs do agents-lab

1. **Não usar chaves reservadas com shape inválido em settings**
   - `extensions` em settings é lista de paths (`string[]`), não objeto de config.
   - Config first-party deve ficar em namespace próprio: `piStack.<extensão>`.

2. **Sempre tratar provider/model como referência completa**
   - usar `provider/model` em defaults e docs.

3. **Separar responsabilidades**
   - `/doctor`: runtime global
   - comandos de domínio (`/monitor-provider`, `/colony-pilot`): validação específica

4. **Pensar em swarms como uma abordagem, não dogma**
   - colony é um estilo de orquestração útil hoje
   - primitivas first-party futuras devem manter contrato de configuração claro e intercambiável

---

## Relação com referências externas (ex.: tuts)

As referências de padrões multi-agente (incluindo exemplos tipo “tuts”) são úteis para desenho de arquitetura, mas no `agents-lab` o critério operacional é:

- configuração mínima explícita de provider/model
- diagnósticos reproduzíveis
- comandos de controle e recovery documentados

Ou seja, padrão conceitual externo entra, mas governança operacional segue os contratos do `pi-stack`.
