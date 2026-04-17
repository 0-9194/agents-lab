# Consumer Quota Visibility (Codex/Copilot) — Continuação

**Data:** 2026-04-14  
**Engine:** Pi + `@aretw0/pi-stack`  
**Status:** Concluído (fase 1 + extensão de janelas 5h)

## Objetivo

Continuar os estudos de eficiência com foco de **consumidor**:

1. ganhar visibilidade de consumo por sessão/modelo/dia;
2. estimar burn rate semanal para detectar esgotamento precoce de cota;
3. gerar evidência estruturada para contestação com fornecedor.

## Hipótese

Mesmo sem API oficial de billing da plataforma, os logs locais do Pi (`~/.pi/agent/sessions`) têm sinais suficientes para:
- reconstruir consumo aproximado de tokens/custo;
- identificar outliers por sessão;
- orientar otimização prática.

## Implementação

Foi adicionada a extensão first-party `quota-visibility` no `@aretw0/pi-stack`:

- comando: `/quota-visibility <status|windows|export> [provider] [days]`
- tool: `quota_visibility_status`
- tool: `quota_visibility_windows`
- tool: `quota_visibility_export`

### Métricas agregadas

- totais: sessões, mensagens, tokens, custo;
- burn rate: média/dia e projeção para 7 dias;
- ranking por modelo (tokens/custo);
- top sessões por tokens e por custo;
- série diária para auditoria temporal;
- análise de janelas rolling por provider (ex.: 5h);
- sugestão de horários para iniciar janela antes de picos históricos.

### Evidência exportável

- JSON em `.pi/reports/quota-visibility-<timestamp>.json`
- pronto para anexar em tickets de suporte/compliance com fornecedor.

## Resultado

A stack passou a ter uma superfície prática de observabilidade de cota em perspectiva de consumidor, sem depender de dashboard externo.

## Artefatos

- `packages/pi-stack/extensions/quota-visibility.ts`
- `docs/guides/quota-visibility.md`

## Conclusões

A visibilidade local não substitui billing oficial, mas resolve 80% do problema operacional:
- identifica onde a cota está sendo consumida;
- reduz discussão baseada em percepção;
- acelera contestação com evidência concreta.

Também ficou explícito que a experiência do `agents-lab` pode divergir da experiência user-like da stack completa. Por isso, foi criado um guia de superfícies reais para evitar falso gap funcional por ausência de pacotes terceiros no ambiente de teste.

## Próximos passos

1. export CSV (além de JSON) para análise em planilha/BI;
2. heurísticas de anomalia (pico súbito vs baseline);
3. score de eficiência por sessão (tokens por resultado útil);
4. adapter entre lifecycle de colônia e `.project/tasks` com revisão humana para fechamento;
5. opcional: painel web integrado ao `web-session-gateway`.
