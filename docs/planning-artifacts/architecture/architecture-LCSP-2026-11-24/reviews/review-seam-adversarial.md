# ADR-028 Final Adversarial Seam Review

## Verdict

**APPROVE.** No current critical, high or medium seam finding remains for the targeted admission-recovery, platform-sponsored settlement, emergency rollback or financial lock-order boundaries.

## Critical findings

None.

## High findings

None.

## Medium findings

None.

## Verified closures

### Single-admission capability and durable recovery

- The capability is no longer described as a transport-level one-use secret.
- PostgreSQL stores only its digest and immutable job/run/lease/invocation binding.
- The worker may persist only an encrypted recovery envelope protected by a worker-local key and restrictive filesystem permissions.
- The proof remains scoped to idempotent evidence delivery/recovery for the same admission, cannot authorize another provider dispatch, and is deleted after terminal acknowledgement.
- Replay safety is governed by admission state and canonical fingerprint rather than unsafe secret deletion after consume.

Independent NestJS and Deepagents implementations therefore have one compatible recovery contract: consume commits `IN_FLIGHT` before provider bytes, restart recovery can deliver the original evidence, and no raw reusable capability is stored or logged.

### Platform-sponsored settlement

- `PLATFORM_SPONSORED` pins a distinct immutable `PlatformSponsorshipPolicySnapshot` rather than a customer tariff.
- It preserves normalized receipt, sponsorship exposure/cost record, audit and operations outbox.
- It writes no customer ledger entry, wallet projection, outstanding balance or customer `PAYMENT_REQUIRED` event.
- Customer-funded settlement remains the only branch that writes `MODEL_USAGE_DEBIT` and customer projection.

The settlement branches are now structurally compatible without fabricating a wallet for system-owned work or dropping usage/cost provenance.

### Emergency rollback

- Rollback stops new admissions and revokes unconsumed customer-funded `ADMITTED` capabilities.
- Existing `IN_FLIGHT` work is never re-dispatched.
- The rollback record explicitly chooses pinned-authority settlement or financial-integrity quarantine; it cannot silently turn provider usage into free usage or mutate an already settled result.
- Quarantined evidence enters `BILLING_INTEGRITY_REVIEW` and requires an audited decision before debit.

This closes the prior ambiguity between processes observing different rollout modes.

### Global financial lock order

Both spine and ADR bind the logical order:

```text
wallet or platform-sponsorship aggregate
→ admission
→ original debit / reconciliation case
→ projection / outbox
```

Implementations may optimize lock mechanics but may not reverse the order, preventing handler-local choices from introducing cross-command deadlock cycles.

## Final gate recommendation

ADR-028 is ready for contract RED design at these seams. Production debit remains correctly blocked by the separately defined `G-01..G-07` evidence and approval gates.

