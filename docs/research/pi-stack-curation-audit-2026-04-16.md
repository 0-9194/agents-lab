# Pi-Stack Curation Audit — 2026-04-16

**Ref**: TASK-BUD-036 · DEC-BUD-016  
**Escopo**: 15 extensões registradas em `packages/pi-stack/package.json#pi.extensions`  
**Princípio**: Dogfooding operacional — ferramentas não usadas internamente no fluxo swarm-first são candidatas a remoção ou fusão.

---

## 1. Inventário + Avaliação

| Extensão | Linhas | Hooks | Tools | Cmds | Criticidade | Veredicto |
|---|---|---|---|---|---|---|
| `colony-pilot` | 3312 | 5 | 4 | 2 | high | **CORE** |
| `quota-visibility` | 1833 | — | 5 | 1 | medium¹ | **CORE** |
| `environment-doctor` | 861 | 1 | 1 | 1 | high | **CORE** |
| `guardrails-core` | 609 | 6 | — | — | high | **CORE** |
| `scheduler-governance` | 608 | 1 | 1 | 1 | high | **ADOTAR** |
| `web-session-gateway` | 584 | 4 | 1 | 1 | medium | **OBSERVAR** |
| `governance-profiles` | 474 | — | 1 | 1 | medium | **ADOTAR / DOGFOOD** |
| `claude-code-adapter` | 415 | — | 2 | 1 | medium | **REFINAR** |
| `safe-boot` | 381 | — | 1 | 1 | high | **ADOTAR** |
| `session-analytics` | 388 | — | 1 | 1 | medium | **ADOTAR** |
| `handoff-advisor` | 379 | — | 1 | 1 | high | **CORE** |
| `quota-alerts` | 361 | — | 1 | 1 | high | **CORE** |
| `monitor-provider-patch` | 633 | 1 | — | 1 | high | **CORE** |
| `stack-sovereignty` | 246 | — | 1 | 1 | high² | **OBSERVAR** |
| `provider-readiness` | 192 | — | 1 | 1 | medium | **ADOTAR** |

¹ Criticidade real é **high** — budget awareness é pre-requisito para qualquer lançamento de swarm.  
² Alta criticidade declarada mas uso interativo baixo; valor real é no CI, não no daily driver.

---

## 2. Análise por Veredicto

### CORE — Não tocar, dogfood ativo

**`colony-pilot`** — backbone do swarm. Intercepta `ant_colony`, aplica gates de preflight/model/budget/delivery, sincroniza com `.project/tasks`. Sem isso nada funciona.

**`quota-visibility`** — ferramenta primária de budget. 5 tools cobrindo status/windows/provider-budgets/route/export. `/quota-visibility` é o comando mais invocado no fluxo operacional. Criticidade real deveria ser `high`.

**`guardrails-core`** — 6 hooks passivos que bloqueiam chamadas quando provider está em BLOCK. Ativo mas invisível — é o guardião silencioso do orçamento global.

**`handoff-advisor`** — recomendação determinística de próximo provider combinando budget+readiness. Execute opt-in auditado. Essencial para operação multi-provider.

**`quota-alerts`** — alertas proativos (WARN/BLOCK + 429-streak + window pressure). Alta densidade de informação, baixo custo de runtime (zero hooks, on-demand).

**`monitor-provider-patch`** — corrige comportamento de providers que não seguem defaults esperados. Configuração ativa no `.pi/settings.json` (classifierThinking: off, hedgeConversationHistory: false). Sem isso há comportamento imprevisível nos providers secundários.

**`environment-doctor`** — roda no `session_start` e entrega widget de saúde. Alta frequência de uso implícito.

---

### ADOTAR — Ativos, consolidados

**`safe-boot`** — recovery path crítico mas raramente invocado (o que é sinal de que funciona bem). Snapshot antes de apply é o padrão correto. Manter; invocar explicitamente no início de runs de alto risco.

**`scheduler-governance`** — hook passivo que observa/enforça scheduling. O `governance-profiles` agora abstrai sua configuração manual, o que melhora a UX. Manter como camada baixo.

**`session-analytics`** — query no JSONL da sessão sem subprocess. Usado pelo `session-triage.mjs`. Potencial subexplorado: swarms deveriam consultá-lo antes de reportar progresso.

**`provider-readiness`** — matriz passiva (config + budget state), zero chamadas de modelo. Útil como pre-launch check antes de `ant_colony`. Baixa fricção, manter.

---

### ADOTAR / DOGFOOD — Novos, precisam de validação real

**`governance-profiles`** — adicionado nesta sessão. Os 3 perfis (conservative/balanced/throughput) encapsulam combinações que eram feitas manualmente. **Ação**: usar `/governance-profile` na próxima troca de modo operacional em vez de editar `.pi/settings.json` diretamente.

---

### OBSERVAR — Baixo uso interativo, potencial justificado

**`web-session-gateway`** — servidor HTTP local que expõe estado de sessão/colônias via URL. Útil quando há necessidade de observação externa (ex: monitorar swarm num segundo terminal ou dispositivo). Baixo uso diário porque o `mode: local` exige abertura manual do browser. 
- Ação: manter mas adicionar ao swarm-launch checklist como "opcional se monitorar remotamente".

**`stack-sovereignty`** — registry de ownership de capabilities + detecção de conflito de scheduler. Valor principal está no CI (`sovereignty-diff-gate.mjs`), não no uso interativo. `/stack-status` é ocasionalmente útil para diagnóstico de extensões conflitantes.
- Ação: manter; documentar que é primariamente um CI check, não daily driver.

---

### REFINAR — Funciona mas tem redundância ou UX rough

**`claude-code-adapter`** — o `claude_code_execute` tool é valioso (executa `claude --print <goal>` com budget governor). Mas `claude_code_adapter_status` é redundante com `provider_readiness_matrix` (já cobre estado de providers incluindo Claude Code). 
- Ação imediata: avaliar se `claude_code_adapter_status` deve ser fundido no `provider_readiness_matrix` ou removido.
- Gap conhecido: sem health check real (dry-run verifica binário mas não autenticação).

---

## 3. Gaps do Fluxo Swarm-First

Ferramentas que **faltam** ou estão **subexpostas** para o workflow atual:

| Gap | Impacto | Candidato |
|---|---|---|
| Visão unificada "o que o swarm está fazendo agora" | Alto — requer consultar colony-pilot + session-analytics separadamente | Novo: `/swarm-status` alias que combina colony-pilot hatch + session-analytics summary |
| `session-analytics` não é invocado automaticamente por swarms | Médio — swarms poderiam auto-consultar antes de reportar | Adicionar hint no prompt de lançamento de colônia |
| `governance-profiles` não aparece no `/doctor hatch` | Médio — operador não sabe qual perfil está ativo | Adicionar `piStack.governanceProfile.active` à saída do hatch check |
| `safe-boot` não é chamado antes de runs de alto risco | Médio — usuário precisa lembrar de snapshottear | Adicionar step no swarm-cleanroom-protocol |

---

## 4. Ações Derivadas

| ID | Ação | Complexidade | Bloqueia |
|---|---|---|---|
| A1 | Marcar `quota-visibility` criticidade como `high` no código | Trivial | — |
| A2 | Avaliar fusão/remoção de `claude_code_adapter_status` | Pequena | — |
| A3 | Adicionar `piStack.governanceProfile.active` à saída do `/colony-pilot hatch check` | Pequena | BUD-043 (routing intent) |
| A4 | Adicionar passo `/safe-boot snapshot` no `swarm-cleanroom-protocol.md` | Trivial | — |
| A5 | Documentar `web-session-gateway` como "optional monitoring" no swarm checklist | Trivial | — |
| A6 | Dogfood `/governance-profile` na próxima troca de modo operacional | Operacional | — |

---

## 5. Status Final

**15 extensões auditadas. 0 candidatas a remoção imediata.**

A stack está bem curada para o fluxo swarm-first atual. O risco principal não é excesso de ferramentas — é **subexposição**: ferramentas como `session-analytics`, `governance-profiles` e `safe-boot` existem mas não estão integradas no fluxo diário de forma explícita.

Próxima rodada de curadoria recomendada: após BUD-043 (intent-based routing) que pode reclassificar como várias extensões são ativadas.
