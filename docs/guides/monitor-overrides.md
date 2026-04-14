# Monitor Overrides — Classifiers sem lock-in de provider

Este guia cobre como manter os classifiers dos monitors funcionando ao alternar entre providers (ex.: GitHub Copilot ↔ OpenAI Codex) sem atrito.

## Problema original

O `@davidorex/pi-behavior-monitors` publica classifiers com modelo bare:

```yaml
model: claude-sonnet-4-6
```

Sem prefixo de provider, o runtime pode resolver para backend errado e os monitors podem ficar inativos sem erro visível.

Investigação: [`experiments/202604-pi-hedge-monitor-investigation`](../../experiments/202604-pi-hedge-monitor-investigation/README.md)  
Issue upstream: [davidorex/pi-project-workflows#1](https://github.com/davidorex/pi-project-workflows/issues/1)

---

## Solução no `@aretw0/pi-stack`

A extensão `monitor-provider-patch` agora:

1. mantém `hedge.monitor.json` com `conversation_history` desabilitado por padrão (opt-in);
2. resolve modelo de classifier por provider (`defaultProvider` + mapa configurável);
3. garante overrides em `.pi/agents/` para os 5 classifiers;
4. avisa quando overrides existentes divergem do provider/modelo atual;
5. fornece comando `/monitor-provider` para diagnosticar e sincronizar.

### Comando principal

> Convenção do laboratório: não criar “doctor” paralelo por domínio.  
> Use `/doctor` para saúde global do runtime e `/monitor-provider` para calibragem dos classifiers.

```text
/monitor-provider status
/monitor-provider apply
/monitor-provider template
```

- `status`: mostra provider ativo, modelo resolvido, saúde do modelo e overrides atuais.
- `apply`: sincroniza os 5 arquivos `.agent.yaml` para o modelo alvo.
- `template`: mostra snippet de configuração para `.pi/settings.json`.

---

## Defaults provider-aware

Defaults embutidos no patch:

- `github-copilot -> github-copilot/claude-haiku-4.5`
- `openai-codex -> openai-codex/gpt-5.4-mini`
- `classifierThinking -> off`

Você pode sobrescrever via settings.

## Configuração recomendada

Em `.pi/settings.json` (ou `~/.pi/agent/settings.json`):

```json
{
  "piStack": {
    "monitorProviderPatch": {
      "classifierThinking": "off",
      "classifierModelByProvider": {
        "github-copilot": "github-copilot/claude-haiku-4.5",
        "openai-codex": "openai-codex/gpt-5.4-mini"
      },
      "hedgeConversationHistory": false
    }
  }
}
```

---

## Mapeamento prático (Claude → Codex)

Para manter classifiers no mesmo “tier” operacional:

| Perfil anterior (Copilot/Claude) | Perfil sugerido (Codex) | Intenção |
|---|---|---|
| `github-copilot/claude-haiku-4.5` | `openai-codex/gpt-5.4-mini` | sensor leve e barato |
| `github-copilot/claude-sonnet-4.6` | `openai-codex/gpt-5.2-codex` (ou `gpt-5.4`) | sensor mais estrito |

> Regra simples: classifiers de monitor tendem a performar melhor com modelo “mini/leve” + `thinking: off`.

---

## Diagnóstico rápido de drift

Se você trocou provider e os monitors “sumiram”:

1. Rode:

   ```text
   /monitor-provider status
   ```

2. Se houver divergência entre modelo resolvido e overrides atuais, rode:

   ```text
   /monitor-provider apply
   /reload
   ```

3. Confirme estado dos monitores:

   ```text
   /monitors status
   ```

---

## Projeto novo

Ao iniciar projeto novo com `@aretw0/pi-stack`:

1. instalar stack (`npx @aretw0/pi-stack --local`);
2. definir `defaultProvider`;
3. configurar `piStack.monitorProviderPatch.classifierModelByProvider`;
4. rodar `/monitor-provider apply`;
5. `/reload`.

Assim você evita copiar `.pi/agents` entre repositórios e reduz lock-in de provider.
