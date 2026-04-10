# Investigação do Monitor Hedge no Pi

**Data:** 2026-04-10  
**Engine:** Pi  
**Status:** Em andamento

## Objetivo

Entender o comportamento do monitor `hedge` introduzido pela stack `@davidorex/pi-project-workflows`, sem tratá-lo como ruído a ser removido por reflexo.

Este experimento existe para responder quatro perguntas:

1. o que o `hedge` tenta fazer?
2. como ele entra no workspace?
3. por que ele falha no nosso ambiente atual?
4. essa falha revela uma expectativa válida do ecossistema ou um acoplamento inadequado?

## Configuração

Contexto do ambiente:

- Pi `0.66.1`
- provider autenticado no fluxo principal: `github-copilot`
- pacote instalado: `@davidorex/pi-project-workflows@0.14.4`
- pacote transitivo relevante: `@davidorex/pi-behavior-monitors@0.14.4`

Reprodução mínima usada:

```bash
pi --provider github-copilot --model gpt-5.4 --no-tools -p "Responda exatamente: OK"
```

Resultado observado:

```text
OK
[hedge] classify failed: No tool call in response (stopReason: error, content: [] error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted)
```

## Descobertas

### 1. O hedge é um sensor de `turn_end`

O monitor projetado no workspace foi materializado em `.pi/monitors/hedge.monitor.json` com a seguinte intenção:

- nome: `hedge`
- descrição: detectar quando o assistant desvia do que o usuário disse
- evento: `turn_end`
- escopo: `main`
- ação: injetar steering quando houver flag ou padrão novo

Isso mostra que o `hedge` não é um detalhe cosmético. Ele é uma camada de correção comportamental pós-resposta.

### 2. O monitor usa um agente classificador dedicado

O arquivo `hedge-classifier.agent.yaml`, dentro do pacote `@davidorex/pi-behavior-monitors`, define:

- `name: hedge-classifier`
- `role: sensor`
- `description: Classifies whether assistant deviated from user intent`
- `model: claude-sonnet-4-6`

O prompt de classificação compara:

- pedido do usuário
- resultados de tools
- resposta mais recente do assistant
- padrões conhecidos de desvio

Ou seja: a intenção do componente é legítima e sofisticada. Ele tenta proteger aderência à intenção do usuário.

### 3. O monitor entra no workspace como artefato opinativo de projeto

Na validação real, o pacote projetou em `.pi/monitors/`:

- `hedge.monitor.json`
- `hedge.patterns.json`
- `hedge.instructions.json`
- `hedge/classify.md`

Isso reforça a hipótese já registrada no laboratório: extensões Pi podem usar o workspace como superfície de configuração e comportamento compartilhado.

### 4. Hipótese técnica atual para a falha

Hipótese mais forte, ainda não tratada como conclusão definitiva:

- o fluxo principal do Pi funciona com `github-copilot`
- o classificador `hedge` declara apenas `model: claude-sonnet-4-6`
- não há provider explícito na definição observada
- a falha reportada é de resolução de autenticação, não de geração principal

Leitura provável:

o classificador auxiliar está sendo executado fora do mesmo contexto de autenticação do fluxo principal, ou assume um método de autenticação que não está disponível com a configuração atual.

## O que este experimento ainda não conclui

Ainda não concluímos:

- se a ausência de provider explícito é a causa imediata da falha
- se o pacote espera alguma configuração adicional do usuário
- se há fallback automático de provider e ele está escolhendo um backend incompatível
- se o comportamento é bug, limitação conhecida ou trade-off deliberado do pacote

## Implicações para o laboratório

Este caso é valioso por três razões:

1. mostra como um pacote pode embutir uma filosofia de correção comportamental
2. mostra como essa filosofia se materializa no workspace
3. mostra como um erro auxiliar pode revelar um desacoplamento imperfeito entre runtime principal e sensores secundários

O aprendizado central aqui não é “desabilitar hedge”.

É reconhecer que o laboratório precisa aprender a ler monitores, sensores e artefatos auxiliares como parte do design do ecossistema.

## Próximos passos

1. localizar no código do pacote onde o agente `hedge-classifier` é resolvido e executado
2. descobrir como o provider é escolhido para agentes sensores
3. testar se há configuração explícita para alinhar o monitor ao provider já autenticado
4. só então decidir entre manter, reconfigurar, isolar ou desabilitar o monitor
