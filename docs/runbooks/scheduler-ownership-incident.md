# Runbook — Incidente de disputa de scheduler ownership

## Sintoma
- aviso: `Another pi instance is managing scheduled tasks for this workspace`
- tasks não disparam nesta sessão ou ficam em review/foreign

## Diagnóstico rápido
1. `/scheduler-governance status`
2. Validar:
   - owner `instanceId/sessionId/pid/cwd`
   - `heartbeatAgeMs`
   - `activeForeignOwner`
   - `foreignTaskCount`
3. `/schedule list` para inspecionar backlog

## Decisão operacional

### Caso A — owner vivo e legítimo
- manter `policy=observe`
- não fazer takeover
- coordenar com time

### Caso B — owner possivelmente órfão (stale)
- `policy=review`
- revisar tarefas
- se confirmado, executar `/scheduler-governance apply takeover`

### Caso C — backlog foreign inválido
- preferir `disable-foreign` antes de `clear-foreign`
- `clear-foreign` apenas após confirmação de impacto

## Segurança (obrigatório)
- takeover/disable/clear exigem confirmação textual forte.
- em non-interactive, destrutivo é bloqueado.

## Pós-incidente
1. registrar causa (duas sessões sem coordenação, session crash, etc.)
2. ajustar policy do workspace (`observe`/`review`)
3. revisar escopo das tasks (`instance` vs `workspace`)
