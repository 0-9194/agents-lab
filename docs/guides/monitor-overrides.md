# Monitor Overrides — Configuração Local dos Classificadores

Este guia explica os overrides em `.pi/agents/` e quando re-aplicá-los em projetos novos.

## O Problema Original

O `@davidorex/pi-behavior-monitors` define os classificadores (hedge, fragility, etc.) com modelo bare:

```yaml
model: claude-sonnet-4-6   # ❌ sem provider, hífen em vez de ponto
```

Sem o provider explícito, o pi tenta resolver o modelo via Anthropic diretamente e falha em ambientes que usam só `github-copilot`. O resultado é **falha silenciosa** — os monitors ficam inativos sem nenhum erro visível.

Investigação documentada em: [`experiments/202604-pi-hedge-monitor-investigation/`](../../experiments/202604-pi-hedge-monitor-investigation/README.md)

Issue upstream aberto: [davidorex/pi-project-workflows#1](https://github.com/davidorex/pi-project-workflows/issues/1)

---

## A Solução: Overrides Locais

Os arquivos em `.pi/agents/` sobrescrevem os agentes do pacote com a spec correta:

```yaml
model: github-copilot/claude-haiku-4.5   # ✅ provider explícito + nome correto
```

Os 5 overrides cobrem todos os classificadores do sistema de monitors:

| Arquivo | Classifier |
|---|---|
| `commit-hygiene-classifier.agent.yaml` | Higiene de commits |
| `fragility-classifier.agent.yaml` | Fragilidades não endereçadas |
| `hedge-classifier.agent.yaml` | Desvio do intent do usuário |
| `unauthorized-action-classifier.agent.yaml` | Ações não autorizadas |
| `work-quality-classifier.agent.yaml` | Qualidade geral do trabalho |

---

## Sintoma de Monitors Inativos

Se os monitors pararem de aparecer no chat sem aviso:

**1. Verificar se o pi-stack está populado:**

```bash
npm run verify
```

Se falhar, re-instalar:

```bash
npm install --prefix packages/pi-stack --no-workspaces
```

Depois fazer `/reload` no pi.

**2. Verificar se os overrides existem:**

```bash
ls .pi/agents/
```

Devem existir os 5 arquivos `.agent.yaml`. Se ausentes, copiar de outro projeto `@aretw0` ou recriar seguindo o padrão:

```yaml
name: <classifier-name>
role: sensor
description: <descrição>
model: github-copilot/claude-haiku-4.5
thinking: "off"
output:
  format: json
  schema: ../schemas/verdict.schema.json
prompt:
  task:
    template: <monitor-name>/classify.md
```

## Default do Hedge Sem conversation_history

O `monitor-provider-patch` também aplica sane defaults no arquivo `.pi/monitors/hedge.monitor.json`.

- Padrão: remove `conversation_history` de `classify.context`
- Objetivo: reduzir contexto desnecessário no classificador hedge desde o primeiro boot
- Opt-in: é possível reativar por configuração

Configuração em `.pi/settings.json` (ou `~/.pi/agent/settings.json`):

```json
{
  "extensions": {
    "monitorProviderPatch": {
      "hedgeConversationHistory": true
    }
  }
}
```

---

## Aplicando em um Projeto Novo

Ao iniciar um projeto novo com `@aretw0/pi-stack`:

1. Instalar a stack: `npx @aretw0/pi-stack --local`
2. Copiar os overrides:

   ```bash
   mkdir -p .pi/agents
   cp /path/to/agents-lab/.pi/agents/*.agent.yaml .pi/agents/
   ```

3. Copiar as configs de monitor de referência de `agents-lab/.pi/monitors/` ou criar as suas.
4. Fazer `/reload`.

---

## Nota sobre o `.gitignore`

Por padrão, `.pi/monitors/` está no `.gitignore` deste projeto (saída operacional de runtime).  
Os `.pi/agents/` **são versionados** — são configuração intencional, não runtime.

Ao criar um projeto derivado, decida conscientemente o que versionar.
