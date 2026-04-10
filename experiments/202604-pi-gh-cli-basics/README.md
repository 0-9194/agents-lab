# Pi + gh CLI: Baseline de Operações GitHub

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Em andamento

## Objetivo

Validar o caminho mais pragmático para convergência do Pi como driver principal em fluxos que hoje dependem de GitHub: usar o `gh` CLI como ponte operacional, em vez de assumir uma integração nativa pronta no ecossistema Pi.

Perguntas do experimento:

1. o ambiente já oferece uma superfície operacional viável para Pi + GitHub?
2. o `gh` CLI pode ser instalado e acionado sem depender de privilégios administrativos?
3. qual é a próxima fricção real para paridade: instalação, autenticação ou ergonomia de uso pelo Pi?

## Configuração

Ambiente usado:

- Windows
- Pi `0.66.1`
- provider autenticado para inferência: `github-copilot`
- repositório remoto: `https://github.com/aretw0/agents-lab.git`

## Procedimento

### 1. Verificação inicial do ambiente

Comandos executados:

```powershell
gh --version
gh auth status
```

Resultado:

- `gh` não estava disponível no `PATH`
- portanto, a primeira fricção real não foi o Pi, mas a ausência da interface operacional com GitHub

### 2. Tentativas de instalação padrão

Foi verificado que o ambiente tinha:

- `winget`
- `choco`

Mas as tentativas de instalação padrão não resolveram o problema de forma utilizável na sessão atual:

- `winget` iniciou a instalação, mas o binário não ficou imediatamente disponível
- `choco` falhou por restrições de permissão em diretórios globais

### 3. Instalação local em escopo de usuário

Solução aplicada:

- download do zip oficial do GitHub CLI
- extração em `C:\Users\aretw\AppData\Local\Programs\GitHubCLI`

Binário validado:

```text
C:\Users\aretw\AppData\Local\Programs\GitHubCLI\bin\gh.exe
```

Validação de versão:

```text
gh version 2.89.0 (2026-03-26)
```

### 4. Verificação de autenticação

Comando executado:

```powershell
& 'C:\Users\aretw\AppData\Local\Programs\GitHubCLI\bin\gh.exe' auth status
```

Resultado:

```text
You are not logged into any GitHub hosts. To log in, run: gh auth login
```

## Descobertas

### 1. O gap atual de paridade com GitHub não está no provider do Pi

O `github-copilot` já atende à camada de inferência, mas isso não resolve operações do GitHub como:

- issues
- pull requests
- comentários
- status checks
- reviews

Ou seja: provider e operação GitHub são camadas diferentes e precisam ser tratadas separadamente.

### 2. O `gh` CLI é viável como ponte operacional imediata

Mesmo sem admin, foi possível colocar o `gh` em funcionamento em escopo de usuário.

Isso torna o `gh` a opção mais pragmática de curto prazo para o laboratório porque:

- já conversa com o GitHub real
- pode ser chamado pelo Pi via shell/tool calling
- evita desenhar abstrações cedo demais

### 3. A fricção seguinte é autenticação, não instalação

Depois da instalação local, o próximo bloqueio real passou a ser o login no GitHub CLI.

Isso redefine o experimento:

- instalação local: resolvida
- integração GitHub: parcialmente destravada
- autenticação do `gh`: ainda pendente

### 4. Autenticação operacional deve permanecer isolada da inferência

Este experimento também deixou mais claro um princípio importante para o laboratório:

- autenticação do provider de inferência não deve ser automaticamente tratada como autenticação operacional de utilitários externos

No caso atual:

- `github-copilot` autentica o Pi para inferência
- `gh` autentica operações GitHub concretas

Essas duas camadas até podem convergir no futuro em alguns cenários, mas não devem ser fundidas por padrão.

Razão principal:

1. pode existir necessidade de operar no GitHub com outra conta
2. pode existir necessidade de escopo diferente de permissão
3. uma extensão não deve "herdar sem querer" uma credencial operacional mais forte do que o necessário

Leitura provisória do laboratório:

- default seguro: isolamento entre credencial de inferência e credencial operacional
- extensão futura: só permitir compartilhamento explícito, com opt-in claro e superfície de configuração visível

## Implicações para o laboratório

Este experimento reforça uma decisão importante:

- curto prazo: Pi + `gh`
- médio prazo: skill ou primitiva só depois de validar fluxos reais repetidos

Também deixa explícito que a convergência para usar o Pi como driver não depende de “esperar o ecossistema maturar sozinho”. Ela depende de compor bem o que já funciona hoje.

Também introduz um princípio transversal para futuras primitivas:

- qualquer utilitário externo com autenticação própria deve começar isolado da credencial do provider
- qualquer ponte entre credenciais deve ser deliberada, reversível e auditável

## Próximos passos

1. autenticar o `gh` no ambiente
2. rodar um primeiro experimento read-only com `gh issue list` e `gh pr list`
3. medir a clareza do fluxo Pi + `gh` em comparação com o uso atual do GitHub Copilot
4. discutir em que cenários uma futura integração poderia oferecer extensão opcional de credenciais sem quebrar isolamento entre contas e permissões
