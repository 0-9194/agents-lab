# Agent Driver Charter — agents-lab

**Status:** active  
**Data:** 2026-04-16  
**Relacionado:** TASK-BUD-016, TASK-BUD-017  
**Revisão humana obrigatória para alterações de critérios de parada ou limites de autonomia.**

---

## Norte verdadeiro (North Star)

Construir um laboratório de agentes que seja **soberano, auditável e auto-sustentável**: capaz de executar ciclos de melhoria sobre si mesmo usando os próprios agentes que produz, com custo controlado, evidência verificável e supervisão humana nos pontos de decisão estratégica.

A operação autônoma é meio, não fim. O objetivo final é ter primitivas e padrões reutilizáveis que outros projetos possam adotar.

---

## Critérios de priorização (como escolher a próxima tarefa)

Um agente autônomo deve seguir esta ordem ao selecionar a próxima tarefa do board:

### 1. Desbloqueadores críticos primeiro

Tarefa é elegível se:
- `status` é `planned` (não `in-progress`, `blocked`, `completed`)
- Todos os `depends_on` estão `completed`
- É `[P0]`

Dentro dos P0, preferir tarefas cujo fechamento **unbloca mais tarefas** (checar quem lista essa task em `depends_on`).

### 2. Depois P1 com dependências satisfeitas

Mesma regra, `[P1]` com todos os `depends_on` resolvidos.

### 3. Nunca tocar

- Tasks com `status: blocked` sem plano de desbloqueio claro
- Tasks com `[COLONY:...]` — essas são instâncias de execução, não backlog
- Tasks com `[RECOVERY:...]` — só avançar após revisão humana

---

## Limites de autonomia

### O que um agente pode fazer sem aprovação humana

- Criar tasks novas (status `planned`) com ID sequencial
- Escrever documentação, guias, research docs
- Implementar código com cobertura de teste
- Fechar tasks de `[P1]` ou `[P2]` quando todos os ACs forem verificáveis via testes/verify
- Registrar evidência em tasks existentes

### O que exige confirmação humana antes de executar

- Fechar tasks `[P0]` estratégicas
- Alterar `status` de tasks de `[COLONY:...]` para `completed`
- Modificar `CLAUDE.md`, `.pi/settings.json`, ou arquivos de governança (`.project/requirements.json`, `.project/decisions.json`)
- Publicar versões (npm publish, tags de release)
- Forçar branches ou reescrever histórico

### Stop conditions (parar e chamar humano)

Um agente deve parar imediatamente quando:

1. **Budget em WARN ou BLOCK** para o provider ativo → chamar `/quota-visibility` e aguardar handoff
2. **Todas as tasks P0 elegíveis bloqueadas** (dependências circulares ou todas precisam de aprovação) → reportar e aguardar
3. **Falha de validação repetida** (verify ou test falhando após 2 tentativas de fix) → não persistir; reportar estado e parar
4. **Conflito de merge não-trivial** em `.project/tasks.json` → não resolver automaticamente; chamar humano
5. **Escopo de mudança > 5 arquivos** numa task que parecia simples → pausar e confirmar escopo antes de continuar

---

## Contratos invariantes (nunca quebrar)

| Contrato | Descrição |
|----------|-----------|
| **No auto-close** | Tasks estratégicas (P0, colonies) só fecham com revisão humana |
| **Evidência obrigatória** | Nenhuma task fecha sem inventário de arquivos + resultado de validação |
| **Board canônico** | `.project/tasks.json` é o relógio oficial — não criar shadow boards |
| **Budget envelope** | Toda execução de colônia exige `maxCost` explícito |
| **Reversibilidade** | Toda mudança crítica deve ter caminho de rollback |
| **Isolamento de sessão** | Runs de CI/automação usam `PI_CODING_AGENT_DIR` isolado |

---

## Como um agente determina a próxima tarefa elegível

```
1. Carregar .project/tasks.json
2. Filtrar: status = 'planned', todos os depends_on = 'completed'
3. Ordenar: P0 primeiro, depois P1, depois P2
4. Para empate: preferir a que desbloqueie mais outras tasks
5. Verificar se não é COLONY:, RECOVERY:, ou task com "requires human"
6. Verificar budget: /quota-visibility → se BLOCK, parar
7. Selecionar e marcar como 'in-progress' no board antes de iniciar
```

---

## Ciclo operacional por run

Cada execução autônoma deve:

1. **Pre-run**: `git status` limpo + `/colony-pilot status` + budget OK
2. **Execução**: uma task por vez; marcar `in-progress` antes de começar
3. **Pós-run imediato**: produzir inventário de arquivos + resultado de validação
4. **Atualizar board**: notas com evidência; task candidata a fechamento (não auto-close P0)
5. **Commit**: somente código testado e verificado; mensagem de commit com task ID

---

## Referências de operação

| Recurso | Uso |
|---------|-----|
| `docs/guides/swarm-cleanroom-protocol.md` | Protocolo completo de pre/pós-run |
| `docs/guides/budget-governance.md` | Budget envelope e governança de custo |
| `docs/guides/quota-visibility.md` | Como auditar consumo e detectar WARN/BLOCK |
| `.project/tasks.json` | Board canônico — fonte de verdade |
| `.project/requirements.json` | Requisitos que fundamentam as tasks |
| `.project/decisions.json` | Decisões já tomadas — não reabrir sem evidência nova |
