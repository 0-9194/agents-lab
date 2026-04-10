# @aretw0/web-skills

## 0.2.0

### Minor Changes

- Primeiro release público da stack curada `@aretw0`.

  ### @aretw0/pi-stack

  Meta-pacote que centraliza 13 pacotes da stack pi curada: `pi-lens`, `pi-web-access`, `@davidorex/pi-project-workflows`, `@ifi/*` (8 pacotes) e `mitsupi`. Inclui `install.mjs` com `npx @aretw0/pi-stack [--local|--remove]` e fallback `pi.cmd` para Windows.

  ### @aretw0/git-skills

  Primeiro pacote first-party. Skills curadas para workflows git:

  - `commit` — Conventional Commits, não-interativo, seguro para agentes
  - `git-workflow` — branching, PRs/MRs, resolução de conflitos, non-interactive safety
  - `github` — `gh` CLI: issues, PRs, CI runs, releases e API queries
  - `glab` — `glab` CLI: issues, merge requests, CI pipelines e API queries (first-party original)

  ### @aretw0/web-skills

  Skills curadas para acesso à web:

  - `native-web-search` — pesquisa via modelo com search nativo (baseado em mitsupi, MIT)
  - `web-browser` — automação de browser via CDP: navegar, screenshot, JS eval, click, logs de rede (baseado em mitsupi, MIT — scripts owned)
