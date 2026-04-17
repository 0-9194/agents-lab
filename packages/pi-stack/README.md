# @aretw0/pi-stack

> Stack curada de extensões pi — um `pi install` que traz tudo.

## Instalação

**Via npm:**

```bash
pi install npm:@aretw0/pi-stack
```

**Via npx (one-click):**

```bash
npx @aretw0/pi-stack           # global
npx @aretw0/pi-stack --local   # projeto atual
npx @aretw0/pi-stack --remove  # desinstalar
```

**Via git (sempre atualizado):**

```bash
pi install https://github.com/aretw0/agents-lab
```

## O que inclui

### First-Party (`@aretw0/*`)

| Pacote | O que traz |
|---|---|
| [`@aretw0/git-skills`](https://www.npmjs.com/package/@aretw0/git-skills) | `commit`, `git-workflow`, `github` (gh CLI), `glab` |
| [`@aretw0/web-skills`](https://www.npmjs.com/package/@aretw0/web-skills) | `native-web-search`, `web-browser` (CDP) |
| [`@aretw0/pi-skills`](https://www.npmjs.com/package/@aretw0/pi-skills) | `terminal-setup`, `create-pi-skill/extension/theme/prompt` |
| [`@aretw0/lab-skills`](https://www.npmjs.com/package/@aretw0/lab-skills) | `evaluate-extension`, `cultivate-primitive`, `stack-feedback` |

### Extensions Incluídas

| Extension | O que faz |
|---|---|
| `monitor-provider-patch` | Patch provider-aware para classifiers de monitor (Copilot/Codex + mapa custom) com comando `/monitor-provider` |
| `environment-doctor` | Health check do ambiente na startup + comando `/doctor` + tool `environment_doctor_status` |
| `claude-code-adapter` | Scaffold experimental para runtime externo Claude Code (`/claude-code status|login|auth-status`, sem persistência de credenciais) |
| `guardrails-core` | Guardrail unificado first-party: proteção de paths sensíveis + roteamento web determinístico por escopo + bloqueio de conflito de porta reservada pelo session-web |
| `colony-pilot` | Primitiva de orquestração/visibilidade: prepara runbooks manuais para pilot (monitors/remote/colony) e mantém snapshot de colonies em background |
| `web-session-gateway` | Gateway web first-party para observabilidade local da sessão (URL determinística, `/api/health` e painel web local) |
| `quota-visibility` | Observabilidade de consumo/cota a partir de `~/.pi/agent/sessions` (burn rate, janelas de 5h/peak hours por provider, export de evidências) |

#### Defaults do `monitor-provider-patch`

| Default | Valor | Configurável? |
|---|---|---|
| Modelo dos classificadores (provider-aware) | `github-copilot -> github-copilot/claude-haiku-4.5`<br>`openai-codex -> openai-codex/gpt-5.4-mini` | Sim (`classifierModel` / `classifierModelByProvider`) |
| Thinking | `off` | Sim (`classifierThinking`) |
| `conversation_history` no hedge monitor | desabilitado | Sim (`hedgeConversationHistory`) |

Exemplo em `.pi/settings.json`:

```json
{
  "piStack": {
    "monitorProviderPatch": {
      "classifierThinking": "off",
      "classifierModelByProvider": {
        "github-copilot": "github-copilot/claude-haiku-4.5",
        "openai-codex": "openai-codex/gpt-5.4-mini"
      },
      "hedgeConversationHistory": true
    }
  }
}
```

Diagnóstico/aplicação rápida:

```text
/monitor-provider status
/monitor-provider apply
/monitor-provider template
```

Detalhes: [`docs/guides/monitor-overrides.md`](../../docs/guides/monitor-overrides.md)

### Tema

| Tema | Descrição |
|---|---|
| `agents-lab` | Tema com realce de código melhorado — cyan/purple para identificadores, contraste alto |

Ativar: `/settings` → selecionar `agents-lab`

### Terceiros Curados

| Pacote | O que traz |
|---|---|
| `pi-lens` | LSP, ast-grep, code analysis |
| `pi-web-access` | Fetch, PDF, YouTube |
| `@davidorex/pi-project-workflows` | Project blocks, workflows YAML, monitors |
| `@ifi/oh-pi-extensions` | safe-guard, git-guard, bg-process, e mais |
| `@ifi/oh-pi-skills` | debug-helper, quick-setup, e mais |
| `@ifi/oh-pi-themes` | Temas visuais |
| `@ifi/oh-pi-prompts` | Prompt templates |
| `@ifi/oh-pi-ant-colony` | Multi-agent swarm |
| `@ifi/pi-extension-subagents` | Subagentes delegáveis |
| `@ifi/pi-plan` | Planejamento com `/plan` |
| `@ifi/pi-spec` | Workflow spec-driven com `/spec` |
| `@ifi/pi-web-remote` | Sessão via web |
| `mitsupi` | multi-edit, review, context, files, todos, e mais |

## Comandos

| Comando | O que faz |
|---|---|
| `/doctor` | Diagnóstico canônico do ambiente (`/doctor` e `/doctor hatch`) — verifica tools/auth/shell/terminal e readiness operacional |
| `/colony-pilot` | Guia pilot (`hatch/check/models/preflight/baseline/run/status/stop/web/monitors/tui/artifacts`), incluindo `hatch doctor` plugin-aware com quick-recovery e hard-gates para `ant_colony` |
| `/session-web` | Controla gateway web first-party (`start/status/open/stop`) para inspeção local da sessão sem UI hospedada externa |
| `/monitor-provider` | Diagnostica e sincroniza modelos dos classifiers dos monitors por provider (`status/apply/template`) |
| `/quota-visibility` | Mostra consumo estimado da janela, projeção semanal, janelas/peak hours, budgets por provider e `route` advisory determinístico (`cheap|balanced|reliable`, `--execute` opt-in) |
| `/scheduler-governance` | Governança de scheduler lease/ownership (`status/policy/apply`) com confirmações fortes para ações destrutivas |
| `/stack-status` | Diagnóstico de soberania da stack: owners por capability, risco de overlap e postura de governança em runtime |
| `/claude-code` | Bridge experimental para Claude Code CLI (status/login/auth-status) |

> Convenção: `/doctor` permanece o diagnóstico global de ambiente/runtime. Comandos verticais como `/monitor-provider`, `/colony-pilot` e `/scheduler-governance` fazem diagnóstico/controle de domínio.
>
> Guia de governança provider/model para colônia e multi-agentes: [`docs/guides/colony-provider-model-governance.md`](../../docs/guides/colony-provider-model-governance.md)
>
> Guia de governança forte do scheduler: [`docs/guides/scheduler-governance.md`](../../docs/guides/scheduler-governance.md)
>
> Guia operacional de soberania (inclui CI artifact + comentário de PR): [`docs/guides/stack-sovereignty-user-guide.md`](../../docs/guides/stack-sovereignty-user-guide.md)

## Baseline de projeto (.pi/settings.json)

Para inicializar defaults versionáveis no workspace (sem depender só de prompt):

```text
/colony-pilot baseline show default
/colony-pilot baseline apply default

# profile mais estrito para próxima fase/execução paralela
/colony-pilot baseline show phase2
/colony-pilot baseline apply phase2
```

Baseline aplicada (default):

```json
{
  "piStack": {
    "colonyPilot": {
      "preflight": {
        "enabled": true,
        "enforceOnAntColonyTool": true,
        "requiredExecutables": ["node", "git", "npm"],
        "requireColonyCapabilities": ["colony", "colonyStop"]
      },
      "budgetPolicy": {
        "enabled": true,
        "enforceOnAntColonyTool": true,
        "requireMaxCost": true,
        "autoInjectMaxCost": true,
        "defaultMaxCostUsd": 2,
        "hardCapUsd": 20,
        "minMaxCostUsd": 0.05,
        "enforceProviderBudgetBlock": false,
        "providerBudgetLookbackDays": 30,
        "allowProviderBudgetOverride": true,
        "providerBudgetOverrideToken": "budget-override:"
      }
    },
    "webSessionGateway": {
      "mode": "local",
      "port": 3100
    },
    "schedulerGovernance": {
      "enabled": true,
      "policy": "observe",
      "requireTextConfirmation": true,
      "allowEnvOverride": true,
      "staleAfterMs": 10000
    },
    "guardrailsCore": {
      "portConflict": {
        "enabled": true,
        "suggestedTestPort": 4173
      }
    }
  }
}
```

## CI de soberania (fail/pass + visibilidade)

No repositório, a soberania é validada por dois níveis:

- **Gate de bloqueio** (job `smoke`):
  - `npm run audit:sovereignty`
  - `npm run audit:sovereignty:diff`
- **Visibilidade operacional** (job `sovereignty-report`):
  - gera `docs/architecture/stack-sovereignty-audit-latest.md`
  - publica artifact `stack-sovereignty-audit`
  - faz upsert de comentário no PR (`<!-- stack-sovereignty-report -->`)

## Filosofia

Este meta-pacote é transitório. Conforme o agents-lab curadoria as primitivas, pacotes first-party vão substituir gradualmente as dependências de terceiros. O objetivo é que `@aretw0/pi-stack` dependa cada vez mais de `@aretw0/*` e menos de terceiros.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
