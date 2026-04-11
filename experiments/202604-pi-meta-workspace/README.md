# Workspace Meta — Dogfooding e Separação de Contextos

**Data:** 2026-04-10
**Engine:** Pi
**Status:** Em andamento

## Objetivo

Investigar como operar o agents-lab como workspace de desenvolvimento **e** como consumidor das suas próprias primitivas ao mesmo tempo, sem que uma dimensão sabote a outra.

A pergunta central:

> Qual modelo de workspace permite que eu edite uma extensão, dê `/reload`, e sinta a diferença — sem que o ato de desenvolver polua a experiência de usar?

## Contexto e Motivação

### O Bug que Revelou o Problema

Nenhum pacote local estava carregando. A causa:

- `.pi/settings.json` usava paths como `"./packages/pi-stack"`
- Pi resolve paths de project settings **relativo a `.pi/`**, não à raiz do projeto
- `./packages/pi-stack` → `.pi/packages/pi-stack` → **não existe**
- Fix: trocar `./` por `../` em todos os 5 pacotes

**Confirmação via source code do pi** (`package-manager.js`):

```javascript
getBaseDirForScope(scope) {
    if (scope === "project") {
        return join(this.cwd, CONFIG_DIR_NAME); // → <cwd>/.pi/
    }
    // ...
}
```

Esse bug foi silencioso — pi não reportou erro, simplesmente não carregou nada do projeto. O único sinal visível foi a ausência de skills e commands na interface.

### A Experiência Meta

O bug acima é sintoma de uma tensão maior:

| Dimensão | O que acontece |
|---|---|
| **Dev** | Edito `environment-doctor.ts`, `commit` skill, ou `lab-skills` |
| **Uso** | Uso essas mesmas ferramentas para operar o lab |
| **Feedback** | Preciso sentir o efeito de mudanças via `/reload` |
| **Publicação** | Preciso publicar no npm sem que o workspace local quebre |

O modelo atual é um monorepo onde o workspace **é** o produto. Isso é poderoso quando funciona, mas frágil quando os paths, scopes ou convenções não estão alinhados.

## Modelos em Avaliação

### Modelo A — Monorepo Unificado (atual)

```
agents-lab/
├── .pi/settings.json    → aponta para ../packages/*
├── packages/
│   ├── pi-stack/        → meta-pacote com bundledDeps
│   ├── git-skills/      → skills first-party
│   └── ...
└── experiments/
```

| Prós | Contras |
|---|---|
| Um repo, um contexto | Paths relativos frágeis (o bug) |
| `/reload` pega mudanças | Polui o workspace com node_modules de dev |
| Coerência total | Confusão entre "o que é projeto" e "o que é produto" |
| Simples para CI | Extensões podem conflitar consigo mesmas |

### Modelo B — Workspace Separado

```
agents-lab/              → repo de dev (packages, CI, publish)
my-workspace/            → repo/dir onde uso pi no dia-a-dia
  .pi/settings.json      → pi install npm:@aretw0/pi-stack
```

| Prós | Contras |
|---|---|
| Experiência limpa de uso | Ciclo publish/install para testar |
| Sem poluição cruzada | Dois repos para manter |
| Simula a experiência real do usuário | Perde o dogfooding imediato |

### Modelo C — Monorepo com Perfis de Workspace

```
agents-lab/
├── .pi/settings.json            → perfil "dev" (local packages)
├── .pi/profiles/consumer.json   → perfil "uso" (npm packages)
├── packages/
└── experiments/
```

Trocar entre perfis via flag ou env var.

| Prós | Contras |
|---|---|
| Um repo, dois modos | Pi não suporta perfis nativamente |
| Dev loop rápido quando precisa | Requer tooling custom |
| Testa a experiência do consumidor | Complexidade de manutenção |

### Modelo D — Monorepo com Symlinks para Auto-Discovery

```
agents-lab/
├── .pi/
│   ├── extensions/
│   │   └── environment-doctor.ts → ../../packages/pi-stack/extensions/environment-doctor.ts
│   └── settings.json             → carrega apenas third-party
├── packages/                     → source of truth
```

| Prós | Contras |
|---|---|
| Auto-discovery funciona | Symlinks são frágeis no Windows |
| `/reload` pega mudanças | Manutenção manual dos links |
| Separa first-party de third-party | Diverge do modelo de distribuição |

## Descobertas Técnicas

### Como pi resolve paths em `.pi/settings.json`

| Scope | Base de resolução | Exemplo |
|---|---|---|
| project | `<cwd>/.pi/` | `"../packages/X"` → `<cwd>/packages/X` ✅ |
| user (global) | `~/.pi/agent/` | `"./extensions/X"` → `~/.pi/agent/extensions/X` |
| top-level extensions/skills/prompts | mesma regra do scope | paths relativos à base |
| dentro de package manifest | relativo ao **package root** | `"./extensions/X.ts"` → `<pkg>/extensions/X.ts` |

### Filtro de skills com `minimatch` — armadilha de diretórios

Segundo bug encontrado: entries de include como `"node_modules/pi-lens/skills"` (sem glob) **não matcham** os arquivos dentro desse diretório.

```
minimatch("node_modules/pi-lens/skills/ast-grep/SKILL.md", "node_modules/pi-lens/skills") → false
```

`minimatch` trata o pattern como match exato, não como "tudo dentro deste diretório". Isso fazia com que o filtro descartasse **todas** as skills.

**Solução**: remover os includes explícitos e manter apenas exclusões:

```json
"skills": [
  "!node_modules/@ifi/oh-pi-skills/skills/git-workflow",
  "!node_modules/mitsupi/skills/github"
]
```

Quando `includes` está vazio, `applyPatterns` retorna tudo (`result = [...allPaths]`), e depois aplica os excludes normalmente. Excludes funcionam porque `matchesAnyPattern` para SKILL.md verifica `parentRel` (o diretório pai da skill), que matcha exatamente o pattern de exclusão.

### Filtro de recursos no object form

```json
{ "source": "../packages/pi-stack", "skills": [...] }
```

- `skills` especificado → aplica filtro personalizado
- `extensions` omitido → carrega **tudo** do manifesto do pacote
- `extensions: []` → carrega **nada**
- `prompts` omitido → carrega tudo do manifesto

### /reload e extensões

Extensões em auto-discovery (`.pi/extensions/`) suportam hot-reload.
Extensões de pacotes locais também são recarregadas via `/reload`.
Commands registrados via `pi.registerCommand()` ficam disponíveis após reload.

## Critérios de Avaliação

Qualquer modelo escolhido precisa atender:

1. **Dev loop** — editar → `/reload` → sentir diferença (< 5 segundos)
2. **Fidelidade** — o que eu uso deve ser o que o consumidor final recebe
3. **Legibilidade** — outro colaborador entende o workspace sem guia verbal
4. **Robustez** — paths não quebram silenciosamente
5. **Publicação** — `npm publish` funciona sem ajustes manuais

## Próximos Passos

- [ ] Validar que o fix `../` funciona via `/reload` (ver skills, extensions, commands)
- [ ] Listar todos os slash commands visíveis após reload
- [ ] Testar `/doctor` e confirmar que as extensões carregaram
- [ ] Documentar qual modelo melhor atende os 5 critérios
- [ ] Decidir modelo e registrar no ROADMAP

## Referências

- [docs/guides/workspace-philosophy.md](../../docs/guides/workspace-philosophy.md) — filosofia de workspace
- [docs/research/extension-factory-friction-analysis.md](../../docs/research/extension-factory-friction-analysis.md) — fricções
- Bug original: paths em `.pi/settings.json` resolvidos de `.pi/`, não da raiz
- Source: `pi-coding-agent/dist/core/package-manager.js` → `getBaseDirForScope()`
