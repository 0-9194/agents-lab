# Pi Embedding — Pesquisa Técnica do Ecossistema

**Status:** draft  
**Data:** 2026-04-16  
**Relacionado:** colony-c3, TASK-BUD-033, TASK-BUD-035

---

## Objetivo

Mapear o estado atual das primitivas de integração/embedding disponíveis no ecossistema pi, identificar lacunas e estabelecer evidência para o guia canônico de embedding em CLIs externas.

---

## 1. Primitivas de instalação disponíveis

### 1.1 `pi install`

O mecanismo central de extensibilidade do pi. Aceita três fontes:

| Forma | Exemplo | Quando usar |
|-------|---------|-------------|
| npm | `pi install npm:@aretw0/pi-stack` | Pacote versionado e publicado |
| git | `pi install https://github.com/aretw0/agents-lab` | Sempre atualizado do repositório |
| local | `pi install ./meu-pacote` | Desenvolvimento local |

O runtime carrega as extensões listadas na configuração do workspace, **não globalmente**. Cada projeto tem seu `.pi/settings.json` e seu conjunto de extensões.

### 1.2 `npx` one-click

O pi-stack expõe um bootstrapper via `bin` no `package.json`:

```bash
npx @aretw0/pi-stack           # instala globalmente
npx @aretw0/pi-stack --local   # instala no projeto atual
npx @aretw0/pi-stack --remove  # desinstala
```

O script (`scripts/pi-pilot-setup.mjs`) detecta o contexto e aplica settings + instala extensões. Este é o modelo de **config embedding** mais simples para projetos externos.

### 1.3 `PI_CODING_AGENT_DIR`

Variável de ambiente que redireciona o diretório de dados do pi (sessões, configurações, extensões instaladas). Uso primário: isolamento de testes.

```bash
PI_CODING_AGENT_DIR=/tmp/pi-test pi ...
```

Também pode ser usado por CLIs externas para dar ao usuário um ambiente pi isolado por projeto, sem conflitar com a instância global.

---

## 2. Mecanismos de configuração por projeto

### 2.1 `.pi/settings.json`

Arquivo de configuração por workspace. Carregado quando o pi é iniciado no diretório do projeto. Aceita:

- `packages`: lista de extensões instaladas (referências npm/git/local)
- `piStack`: configurações das extensões first-party

Um projeto externo pode incluir `.pi/settings.json` no repositório e documentar que o usuário deve ter o pi instalado.

### 2.2 Namespace `piStack`

As extensões first-party leem configurações sob `settings.piStack.<extensionKey>`. Um projeto que distribui extensões customizadas pode definir seu próprio namespace para evitar colisão.

```json
{
  "piStack": {
    "meuProjeto": {
      "featureX": true
    }
  }
}
```

---

## 3. Ciclo de vida de sessão

### 3.1 Sessões locais

Armazenadas em `~/.pi/agent/sessions/<workspace-slug>/*.jsonl`. O slug é derivado do caminho absoluto do workspace.

Estrutura de cada evento JSONL:
- `type`: `user` | `assistant` | `tool_call` | `tool_result`
- `timestamp`: ISO 8601
- Campos de uso de tokens (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`)

Um projeto externo pode consumir esses arquivos para observabilidade sem depender de APIs proprietárias — exatamente o que `quota-visibility` faz.

### 3.2 Scope de provider e auth

Auth é gerenciado pelo pi a nível de provider (`~/.pi/providers/`). O projeto embedding **não gerencia credenciais** — o usuário configura uma vez globalmente e todos os projetos que usam pi herdam o mesmo contexto de autenticação.

---

## 4. Superfície de extensão

### 4.1 Extension API (`ExtensionAPI`)

Exportada por `@mariozechner/pi-coding-agent`. Permite:

| Método | O que faz |
|--------|-----------|
| `registerTool(...)` | Expõe tool ao agente (schema TypeBox + handler) |
| `registerCommand(...)` | Expõe comando slash (`/meu-comando`) |
| `runProcess(cmd, args)` | Executa subprocesso a partir da extensão |
| `on('tool_call', ...)` | Intercepta chamadas de tool (guardrails, patches) |

Extensões são funções exportadas como `default` que recebem a API como argumento — ver `packages/pi-stack/extensions/claude-code-adapter.ts` como exemplo mínimo.

### 4.2 Skills (Markdown)

Skills são arquivos `SKILL.md` em `packages/<pacote>/skills/<nome>/`. São carregadas no contexto da sessão do agente quando o pacote está instalado. Controlam raciocínio e comportamento, não runtime.

Heurística: se o problema é instrução recorrente, skill. Se exige hooks, tools ou persistência, extension.

---

## 5. Lacunas identificadas

| Lacuna | Impacto | Relacionado |
|--------|---------|-------------|
| Não há template canônico de projeto embedável | Fricção alta para novos projetos | TASK-BUD-035 |
| `PI_CODING_AGENT_DIR` sem documentação de uso por projeto | Isolamento por projeto é desconhecido | — |
| Sem mecanismo de dispatch por intenção (skill routing) | Usuário precisa nomear skill explicitamente | TASK-BUD-043 |
| `npx` bootstrapper não cobre namespace customizado | Projetos externos copiam config manualmente | TASK-BUD-035 |
| Sessões globais em `~/.pi/`; isolamento só via env var | Observabilidade misturada entre projetos sem config explícita | — |

---

## 6. Referências

- `packages/pi-stack/extensions/claude-code-adapter.ts` — padrão de subprocess bridge
- `packages/pi-stack/extensions/quota-visibility.ts` — consumo de sessões locais como observabilidade
- `docs/guides/testing-isolation.md` — uso de `PI_CODING_AGENT_DIR`
- `docs/research/extension-factory-blueprint.md` — blueprint da fábrica de extensões
- `scripts/pi-pilot-setup.mjs` — bootstrapper npx existente
- `@mariozechner/pi-coding-agent` — SDK core do pi
