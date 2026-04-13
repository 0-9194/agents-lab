---
created: 2026-04-13
status: draft
---

# Web Routing — Próximos Passos Operacionais

Checklist vivo para não deixar backlog preso só na conversa.

## Concluídos

- [x] Policy de roteamento documentada em skills first-party (`source-research` e `web-browser`)
- [x] A/B inicial (`run-2026-04-13`) para avaliar hard enforcement global
- [x] Revalidação sem VPN focada em npmjs/Cloudflare (`run-2026-04-13-novpn-cf`)

## Em andamento

- [ ] Definir implementação de **hard por escopo** (não global):
  - triggers: prompts com intent interativo + domínio/npmjs sensível
  - fallback explícito quando CDP falhar

## Próximos experimentos

- [ ] Repetir o taskset `cloudflare-recheck` por 3 rodadas para reduzir variância
- [ ] Criar taskset de autenticação/formulário (login real em ambiente de teste) para medir vantagem estrutural de CDP
- [ ] Medir custo incremental de setup browser (`start.js`) em sessão fria vs sessão quente

## Decisões pendentes de curadoria

- [ ] Decidir se `@ifi/oh-pi-skills/web-search` e `web-fetch` permanecem como fallback explícito
- [ ] Ou se entram em `FILTER_PATCHES` para reduzir ambiguidade da stack

## Critérios de saída desta trilha

- [ ] Documento de decisão final: quando usar soft policy, hard por escopo, ou hard global
- [ ] Pull request com mudanças de policy/installer + testes de regressão de roteamento
