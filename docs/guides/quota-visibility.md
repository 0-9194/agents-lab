# Visibilidade de Cota e Consumo (perspectiva do consumidor)

Guia para auditar consumo de tokens/custo localmente e gerar evidências para contestação com fornecedores de modelo.

> Fonte primária dos dados: `~/.pi/agent/sessions/**/*.jsonl`.

---

## Problema que este guia resolve

Quando a cota semanal “some rápido”, a pergunta correta não é só *quanto* foi gasto, mas **onde**, **quando** e **em qual modelo**.

Sem isso, é difícil:
- contestar anomalias com suporte do fornecedor;
- separar uso real de picos acidentais;
- otimizar prompt/fluxo sem achismo.

Antes de analisar números, confirme paridade do ambiente:

```bash
npm run pi:parity
```

---

## Ferramentas no `@aretw0/pi-stack`

> Na stack completa, isso complementa superfícies já existentes como `/usage` (`@ifi/oh-pi-extensions`) e `/session-breakdown` (`mitsupi`).

A extensão `quota-visibility` adiciona:

- comando: `/quota-visibility <status|windows|export> [provider] [days]`
- tools:
  - `quota_visibility_status`
  - `quota_visibility_windows`
  - `quota_visibility_export`

### 1) Status rápido (janela padrão)

```text
/quota-visibility status
```

Mostra:
- tokens e custo na janela;
- burn rate diário (calendário);
- projeção de 7 dias;
- modelo e sessão de maior consumo.

### 2) Status em janela maior

```text
/quota-visibility status 30
```

Útil para diferenciar pico pontual vs. tendência.

### 3) Janelas de 5h e peak hours (Anthropic/Codex)

```text
/quota-visibility windows
/quota-visibility windows anthropic 14
/quota-visibility windows openai-codex 14
```

Mostra, por provider:
- consumo da janela rolling (ex.: 5h);
- maior janela observada no período;
- horas de pico históricas (tendência local);
- sugestões de início de janela **antes** de pico;
- horários de início com menor demanda histórica.

Mesmo que vocês usem pouco Anthropic no Pi, manter `anthropic: 5` configurado ajuda a ter o monitor pronto para quando precisarem validar janelas reais.

> Importante: isso é evidência estatística local, não garantia oficial do provider.

### 4) Export para evidência

```text
/quota-visibility export 7
```

Gera arquivo JSON em:

```text
.pi/reports/quota-visibility-<timestamp>.json
```

Esse bundle é o anexo ideal para abrir ticket com provedor.

---

## Configuração opcional (meta semanal + providers com janela curta)

Em `.pi/settings.json`:

```json
{
  "piStack": {
    "quotaVisibility": {
      "defaultDays": 7,
      "weeklyQuotaTokens": 250000,
      "weeklyQuotaCostUsd": 25,
      "providerWindowHours": {
        "anthropic": 5,
        "openai-codex": 5
      }
    }
  }
}
```

Com isso, o status também mostra `% usado` e `% projetado` da semana, além de monitoramento das janelas rolling por provider.

Se o Codex passar a operar com peak hours de forma mais explícita, você já terá baseline histórico para reagir rápido.

---

## Checklist de contestação (fornecedor)

Ao abrir chamado, inclua:

1. período afetado (ex.: últimos 7 dias)
2. export JSON do `quota-visibility`
3. top sessões por tokens/custo
4. modelos mais caros na janela
5. horário aproximado dos picos e janelas de maior concentração (5h)
6. expectativa de consumo (plano contratado)

Sugestão de framing:
- “Identificamos aceleração de consumo fora do padrão esperado no período X.”
- “Segue evidência local por sessão/modelo, com projeção semanal, janelas rolling e outliers.”
- “Precisamos da reconciliação entre nosso log e o medidor da plataforma.”

---

## Otimização prática (sem perder qualidade)

Cruze este guia com [`token-efficiency.md`](./token-efficiency.md):

- use modelos leves para sensores/monitores;
- reduza contexto desnecessário (`conversation_history` quando não agrega);
- leia/edite de forma cirúrgica para evitar turnos longos;
- audite semanalmente top sessões para detectar regressões cedo.

A combinação **eficiência + evidência** evita tanto desperdício quanto discussão sem dados.
