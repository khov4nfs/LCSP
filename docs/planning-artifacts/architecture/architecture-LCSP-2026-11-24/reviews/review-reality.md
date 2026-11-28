# ADR-028 Brownfield Reality — Final Confirmation

## Verdict

**APPROVE.** No critical, high or medium source-reality finding remains. The updated spine and ADR now close every previously identified brownfield seam without contradicting current LCSP billing, worker telemetry, Prisma or runtime-admission behavior.

## Final targeted confirmation

| Target                             | Final rule                                                                                                                                                                                                                                                                                                                                     | Confirmation                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funding-principal union            | ADR §3 binds either customer owner/wallet or immutable platform sponsorship policy; spine AD-13 binds customer tariff only to `CUSTOMER_WALLET` and a distinct `PlatformSponsorshipPolicySnapshot` to `PLATFORM_SPONSORED`.                                                                                                                    | **PASS.** Ownerless preparation is governed without fabricating a customer wallet or resolving a customer tariff. The discriminator/principal is part of immutable admission authority.                 |
| Authoritative admission CAS        | ADR §3 assigns `ADMITTED → IN_FLIGHT` to NestJS/PostgreSQL before provider bytes. The spine diagram now says `worker requests server CAS`.                                                                                                                                                                                                     | **PASS.** There is no remaining suggestion that the Python SQLite journal can consume customer-financial admission independently.                                                                       |
| Capability recovery/key operations | ADR §3 permits only an encrypted worker recovery envelope until terminal acknowledgement; the server stores only a digest. Verification requires startup, rotation, loss-recovery and terminal-deletion runbook tests. `docs/implementation/persistence-implementation.md` adds retention, secret controls and worker-crash recovery behavior. | **PASS.** Restart recovery can deliver evidence for the same invocation without storing plaintext authority or replaying the provider call. `G-06/G-07` cannot turn GREEN without operational evidence. |
| Legacy versus customer tariff      | `CustomerModelTariffDraft/Snapshot/Assignment` are distinct from legacy `ModelPricingSnapshot`, which remains reference-only.                                                                                                                                                                                                                  | **PASS.** Existing FX/markup/provider-reference rows cannot become billable by inference.                                                                                                               |
| Signed microcredit path            | Append-only microcredit ledger is authoritative; wallet is its signed projection; the current nonnegative `BillingAccountingKernel` cannot be reused unchanged.                                                                                                                                                                                | **PASS.** Current public-credit behavior is treated as migration compatibility, not proof that negative/outstanding settlement already exists.                                                          |
| Python `RunAdmission` boundary     | ADR explicitly distinguishes the local SQLite runtime journal from `BillableInvocationAdmission` and gives the NestJS/PostgreSQL state machine precedence.                                                                                                                                                                                     | **PASS.** Existing nano-USD/runtime fields remain non-authoritative for the customer wallet.                                                                                                            |

## Source anchors revalidated

- `packages/contracts/src/billing/prepaid.ts`: current `1 VND = 1 credit` top-up baseline.
- `packages/contracts/src/billing/usage.ts` and `deepagents/.../callback_schemas.py`: legacy provider usage remains telemetry-only with no monetary fields.
- `apps/api/.../billing-usage.kernel.ts`: usage recording does not reserve or debit wallet credits.
- `apps/api/.../billing-accounting.kernel.ts`: current generic debit rejects a negative available balance, matching the ADR's explicit migration boundary.
- `apps/api/prisma/schema.prisma`: legacy wallet/reservation/reference-pricing models exist and require the ADR's expand-only distinct entities.
- `deepagents/middleware/usage_metering.py` and `paid_admission.py`: current worker creates local attempt IDs/admission state; the ADR correctly treats these as integration/migration points rather than server financial authority.

## Graphify provenance

Graphify remains navigation-only. No inferred or absent graph edge is used as proof; all material confirmations above were checked in current source and planning artifacts.

## Gate recommendation

The reality-check gate is GREEN for architecture finalization. Remaining tariff values, numeric exposure/concurrency policy and production debit evidence remain intentionally governed by `G-01..G-07`, not unresolved architecture defects.
