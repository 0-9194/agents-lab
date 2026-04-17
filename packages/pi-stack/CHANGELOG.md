# @aretw0/pi-stack

## 0.7.0

### Minor Changes

- Add `quota-panel.ts` extension — toggleable provider usage panel for the pi footer.

  **New extension: `quota-panel`**

  Expands the pi footer with 3 live sections when active:

  - **Provider Budgets**: per-provider progress bars (`█▌░`), usage %, observed vs cap values, WARN `⚠` / BLOCK `✗` state icons
  - **Rolling Windows**: recent vs historical max token windows, peak hours, suggested start times
  - **Route Advisory**: balanced routing recommendation with per-provider pressure %

  **Command: `/qp off|on|auto|snapshot`**

  | Mode       | Behavior                                                    |
  | ---------- | ----------------------------------------------------------- |
  | `off`      | Always hidden (default)                                     |
  | `on`       | Always visible in footer                                    |
  | `auto`     | Opens on WARN/BLOCK, closes when all providers return to OK |
  | `snapshot` | One-shot ephemeral notification, works in any mode          |

  Data refreshes async on each `turn_start` with a 30s cache — no impact on render performance. Requires `providerBudgets` configured in `.pi/settings.json` (`piStack.quotaVisibility`).

  **Footer integration**: `custom-footer.ts` injects panel lines automatically when `shouldShowPanel()` returns true. No visual change when panel is off.

## 0.6.0

### Minor Changes

- Add 9 new capabilities to the control plane: safe-core boot profile, provider handoff execute path, per-call delivery mode override, proactive quota alerts, deterministic handoff advisor, session analytics query primitive, Claude Code CLI adapter with request-budget governor, installer baseline flag, and passive provider readiness matrix.

  **New extensions:**

  - **safe-boot**: settings snapshot/restore + safe-core profile (`delivery=report-only`, `scheduler=observe`, `gateway=local`). `/safe-boot [apply|snapshot|restore|list|recover]` command with single-command rollback.

  - **quota-alerts**: proactive WARN/BLOCK + 429-streak detection + overage consent gate. `quota_alerts` tool + `/quota-alerts` command with structured `AlertEntry` list (severity, message, action).

  - **session-analytics**: queryable session log primitive for swarms. Reads JSONL directly — no subprocess. Supports `signals|timeline|model-usage|summary` query types with `lookback_hours` filter. `/session-analytics` command.

  **Extension upgrades:**

  - **colony-pilot**: `ant_colony` now accepts `deliveryMode?: ColonyDeliveryMode` per-call override, eliminating the need to edit global config. Override is audited via `pi.appendEntry`. New `/colony-promote <goal>` command pre-fills `apply-to-branch` call.

  - **handoff-advisor**: added `execute: true` opt-in path to both `handoff_advisor` tool and `/handoff` command. When executed, calls `pi.setModel()` and logs route decision via `pi.appendEntry`. `--execute` / `--apply` flags with optional `--reason <text>`.

  - **handoff-advisor v2** (BUD-037): deterministic score combining `budget_state` (quota-visibility) + `readiness` (provider-readiness). `computeHandoffScore = budget_score + readiness_score`. Returns `current_state`, `recommended_next`, `switch_command`, `blocked_providers`. `noAutoSwitch` invariant enforced.

  - **claude-code-adapter**: evolved into full provider with request-budget governor (`ok/warn/block` by session cap). `claude_code_execute` tool with dry-run mode and isolated `cwd` per execution. `/claude-code budget` command. `buildProviderHint` exposes `routeModelRef` suggestion for quota-visibility.

  - **installer**: new `--baseline` (`-b`) flag applies non-destructive theme + colony-pilot + claude-code defaults via `deepMergeForBaseline`. Preserves existing user config.

  - **provider-readiness**: re-implemented as passive health matrix (config + budget state only). Removed non-existent `pi.loadModel()` call. `/provider-matrix` and `provider_readiness_matrix` tool now work correctly at runtime.

## 0.5.0

### Minor Changes

- 07342e3: Harden runtime governance and hatch UX for multi-provider operation:

  - add hatch readiness workflow improvements (`/colony-pilot hatch`) and deterministic onboarding checks
  - enforce provider-budget BLOCK globally via guardrails control-plane (with audited override and recovery allowlist)
  - expand quota visibility to support request-based provider budgets (Copilot premium requests) with weekly/monthly caps and share semantics
  - improve governance docs for budget operations and recovery flows

## 0.4.2

### Patch Changes

- efc6313: Block `ant_colony` launches that request materialization/apply when `colony-pilot` delivery mode is `patch-artifact`.

  Adds explicit operator feedback with corrective action (`apply-to-branch` + `/reload`) and parser test coverage for materialization-goal detection.

## 0.4.1

### Patch Changes

- 200a74b: Fix cross-platform handling of Windows-style paths in colony runtime mirror detection.

  This prevents smoke test failures on Linux CI when validating Windows path normalization.

## 0.4.0

### Minor Changes

- abf785e: Add first-party stack sovereignty governance with capability ownership registry,
  new `/stack-status` diagnostics, and dedicated scheduler governance controls.

  This release also introduces CI sovereignty enforcement and visibility:
  strict audit gates, diff-aware capability annotation checks, and PR artifact/comment reporting.

## 0.3.10

### Patch Changes

- cobre o cenário de primeiro hatch do hedge monitor no formato davidorex, removendo `conversation_history` de `classify.context` por padrão e adicionando testes de integração para evitar regressão.

  também preserva e organiza a documentação de eficiência de tokens/calibração de monitores em `docs/guides` e `experiments`.

## 0.3.9

### Patch Changes

- Refina o fluxo de desenvolvimento do pi-stack para o modelo pós-"guarda-chuva":

  - remove o package-lock legado de packages/pi-stack
  - atualiza smoke tests para resolver dependências third-party com prioridade em node_modules da raiz (fallback para node_modules local do pacote)
  - reduz drift entre ambiente local e setup de workspaces, mantendo a cobertura de curadoria e filtros

## 0.3.8

### Patch Changes

- Update monitor defaults for davidorex compatibility:

  - switch monitor-provider-patch classifier overrides from claude-sonnet to claude-haiku
  - set classifier thinking to off by default
  - make hedge monitor conversation_history opt-in via settings
  - apply sane defaults on session_start for already initialized workspaces
  - document the new defaults in pi-stack docs

## 0.2.1

### Patch Changes

- ### @aretw0/pi-stack

  Sincroniza commits que ficaram fora da tag v0.2.0:

  - Extension `environment-doctor`: detecção e auto-fix de configuração de terminal (shift+enter / alt+enter para Windows Terminal, Ghostty, WezTerm, VS Code)
  - Extension `read-guard`: proteção de leitura fora do diretório do projeto
  - Tema `agents-lab` incluído no manifesto pi
  - Fix: JSON inválido no manifesto pi — duplicata de `themes` removida

## 0.2.0

### Minor Changes

- ### @aretw0/pi-stack

  - Extension `monitor-provider-patch`: fix automático de classifiers para github-copilot — detecta provider na session_start e cria overrides em `.pi/agents/` se ausentes (14 testes)
  - Manifesto `pi` na raiz para instalação via `pi install https://github.com/aretw0/agents-lab`

  ### @aretw0/pi-skills (novo)

  Skills de fábrica para criar e configurar o ecossistema pi:

  - `terminal-setup` — diagnóstico e configuração de terminal (Windows Terminal, Ghostty, WezTerm, VS Code)
  - `create-pi-skill` — como criar skills com empacotamento npm
  - `create-pi-extension` — como criar extensões TypeScript com tools, commands e eventos
  - `create-pi-theme` — como criar temas visuais
  - `create-pi-prompt` — como criar prompt templates com argumentos

  ### @aretw0/lab-skills (novo)

  Skills experimentais para cultivo de primitivas e curadoria:

  - `evaluate-extension` — scorecard estruturado para avaliar extensões (anti-slop)
  - `cultivate-primitive` — guia de cultivo da identificação ao pacote publicado
  - `stack-feedback` — coleta feedback estruturado sobre a stack via issues GitHub
