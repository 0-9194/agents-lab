---
created: 2026-04-13
status: draft
---

# Web Overlap Scorecard — agents-lab

## Objetivo

Detalhar onde o overlap de Web na stack é **complementar** versus **redundante** e propor winners operacionais para reduzir ambiguidade de uso pelo agente.

## Evidência usada

- Inventário estático gerado em `docs/research/data/web-overlap-inventory.json`
- Leitura de skills e extensões:
  - `node_modules/@ifi/oh-pi-skills/skills/web-search/SKILL.md`
  - `node_modules/@ifi/oh-pi-skills/skills/web-fetch/SKILL.md`
  - `node_modules/@ifi/oh-pi-skills/skills/web-search/search.js`
  - `node_modules/@ifi/oh-pi-skills/skills/web-fetch/fetch.js`
  - `node_modules/pi-web-access/index.ts`
  - `node_modules/pi-web-access/skills/librarian/SKILL.md`
  - `packages/web-skills/skills/source-research/SKILL.md`

## Inventário resumido

### @ifi/oh-pi-skills (camada skill-only)

- `web-search`: busca simples DuckDuckGo via script local.
- `web-fetch`: fetch + extração básica de texto.
- `context7`: consulta docs de bibliotecas via API Context7.

### pi-web-access (camada extension/tooling)

Tools:
- `web_search`
- `fetch_content`
- `code_search`
- `get_search_content`

Comandos:
- `/websearch`
- `/curator`
- `/google-account`
- `/search`

### @aretw0/web-skills (camada playbook)

- `source-research`: estratégia de pesquisa com evidências/permalinks.
- `web-browser`: automação CDP para navegação e interação.

## Análise de overlap

## 1) Web search

**Sobreposição:**
- `oh-pi/web-search` e `pi-web-access/web_search` resolvem o mesmo objetivo base (buscar na web).

**Diferença material:**
- `oh-pi/web-search` = caminho mínimo, pouca infraestrutura.
- `pi-web-access/web_search` = providers múltiplos, fluxo curator, integração com fetch e persistência de resultados.

**Conclusão 1:** overlap **complementar**, mas com risco de UX ambígua para o agente (dois caminhos válidos para o mesmo pedido).

## 2) Web fetch/extract

**Sobreposição:**
- `oh-pi/web-fetch` e `pi-web-access/fetch_content` extraem conteúdo de URL.

**Diferença material:**
- `oh-pi/web-fetch` = versão leve.
- `pi-web-access/fetch_content` = URL única/múltiplas, PDF, YouTube, vídeo local, clone de repositório, integração com cache/result storage.

**Conclusão 2:** overlap **assimétrico**; `pi-web-access` cobre cenários avançados com vantagem clara.

## 3) Research orchestration

**Sobreposição:**
- `pi-web-access/librarian` e `@aretw0/web-skills/source-research` têm objetivos muito próximos no modo de trabalho (pesquisa com evidências).

**Estado atual:**
- stack já filtra `pi-web-access/librarian` e mantém estratégia first-party para esse papel.

**Conclusão 3:** direção atual está correta: manter a orquestração de pesquisa em first-party (`source-research`) e usar `pi-web-access` como base de tools.

---

## Winners operacionais propostos (Web)

| Capability | Winner proposto | Papel dos demais |
|---|---|---|
| quick web lookup | `oh-pi/web-search` **ou** habilidade first-party equivalente (futuro) | `pi-web-access/web_search` reservado para pesquisa mais robusta |
| deep research | `@aretw0/web-skills/source-research` + `pi-web-access` tools | `oh-pi/web-search` como fallback rápido |
| web content extraction | `pi-web-access/fetch_content` | `oh-pi/web-fetch` como fallback mínimo |
| interactive browsing | `@aretw0/web-skills/web-browser` | `mitsupi/web-browser` já suprimido na stack |

> Observação: o principal problema hoje não é colisão técnica, e sim **determinismo de escolha** durante a execução.

## Recomendação imediata

1. Definir no `source-research` uma regra explícita de roteamento:
   - perguntas simples → quick lookup
   - pesquisa profunda/evidência → `web_search` + `fetch_content` + leitura de código
2. Decidir se `oh-pi/web-search` e `oh-pi/web-fetch` continuam ativos como fallback intencional ou serão filtrados no installer para reduzir ambiguidade.
3. Se mantiver ativos, documentar hierarquia de uso em `docs/guides/recommended-pi-stack.md`.

## Próxima validação (runtime)

Rodar benchmark manual com third-party ativa:

- 2 tarefas quick lookup
- 2 tarefas deep research
- 2 tarefas browser automation

Métricas:
- tempo até resposta útil
- qualidade/precisão
- ruído operacional
- repetibilidade (o agente escolhe sempre a mesma rota?)
