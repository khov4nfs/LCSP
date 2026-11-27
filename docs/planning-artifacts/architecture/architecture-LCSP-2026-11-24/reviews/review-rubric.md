# ADR-028 Architecture Spine Final Targeted Review

## Verdict

**APPROVE for finalization.** Both remaining gaps are closed, and the targeted pass found no new critical or high-severity regression.

## Closed findings

### Capability recovery

- The admission capability now remains valid only for the same immutable admission's consume/evidence-recovery lifecycle.
- PostgreSQL stores only the digest.
- Deepagents may persist only an encrypted recovery envelope, never plaintext/log/telemetry, and deletes it after terminal acknowledgement.
- Replay safety comes from server admission state and canonical fingerprints; restart recovery cannot trigger a second provider dispatch.

This resolves the prior contradiction between secret non-persistence and durable settlement recovery.

### Platform sponsorship

- `CUSTOMER_WALLET` binds `CustomerModelTariffSnapshot` and may affect only the bound customer wallet.
- `PLATFORM_SPONSORED` binds a distinct immutable `PlatformSponsorshipPolicySnapshot` for provider-cost/exposure control.
- The platform branch writes normalized usage, sponsorship cost/exposure, audit and operations outbox only; it cannot resolve a customer tariff, create a customer debit/outstanding balance or emit customer payment-required state.
- Ownerless work without approved sponsorship fails before dispatch.

This prevents internal cost-control values from becoming customer tariff or ledger authority.

## Medium follow-up

### Worker recovery-encryption operations need an implementation runbook

The architecture correctly requires an encrypted recovery envelope and worker-local key, but key provisioning, restrictive-file ownership, loss behavior and rotation/re-encryption procedure are implementation/operations details still to document. Key loss must leave the invocation in reconciliation/integrity review rather than bypass capability verification or infer zero usage.

This does not block the architecture spine because the safety behavior is already fail-closed, but it must be covered before `G-06`/`G-07` can be GREEN.

