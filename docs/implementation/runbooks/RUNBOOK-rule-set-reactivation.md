# Existing Rule Set reactivation

Rule Set authority is global. Reactivation restores an existing accepted version; it does not create a Preparation or generate a new Rule Set.

An authenticated active Admin calls `POST /admin/compliance-rule-sets/:ruleSetVersionId/reactivate` with:

```json
{
  "expectedActiveRuleSetVersionId": "<reviewed current ACTIVE UUID>",
  "idempotencyKey": "<durable unique operation identity>",
  "reason": "SEMANTIC_AUTHORITY_CONTAINMENT"
}
```

The request attests that the authority being replaced failed semantic acceptance. The target must be SUPERSEDED, have an original PASSED activation and SUCCEEDED Preparation, retain its accepted packet and child digests, and have persisted requirements/rules and source pins. A version previously replaced for semantic containment cannot be reactivated. The operation checks stored historical integrity; it neither interprets legal meaning nor applies today's authoring/effect rules retroactively. A superseded immutable Legal Source Version is allowed, and its status is never changed.

The handler acquires the same `lcsp:compliance-rule-set-activation` transaction advisory lock as normal activation. Under that lock it checks idempotency, compares the expected ACTIVE ID and rejects active Preparations. A changed ACTIVE pointer fails closed. A successful transaction supersedes the current version, activates the target, writes a new immutable `ComplianceRuleSetReactivationRecord`, writes the domain audit and enqueues `event.compliance-rule-set.reactivated.v1`. The event is distinct from Preparation completion and source activation; existing event consumers do not schedule work or repin Assessments for it.

The transition receipt preserves the target's prior activation/supersession timestamps and the previous authority's activation timestamp. `ComplianceRuleSetVersion.activatedAt` becomes the latest reactivation time; its original one-time acceptance record remains unchanged. Reusing the same key and request returns the original receipt, without new writes; changing actor, target, expected ACTIVE or reason under the same key conflicts. A different key against an already-active target is a typed conflict.

Before an operation, check authoritative ACTIVE identity/count, target history/integrity, Preparation/native runtime quiescence, relevant outbox and all current Assessment pins. Afterward verify exactly one ACTIVE target, the previous version SUPERSEDED, one new transition/domain audit/outbox receipt, normal outbox publication, unchanged source and Assessment pins, no new Preparation and healthy services. Do not replay a production mutation solely to demonstrate idempotency.

Migration `20261016040000_rule_set_reactivation` is additive. It preserves original activation-row uniqueness, immutable-child guards and the database single-ACTIVE index. Apply committed migrations through the normal deployment process; never issue an operator SQL status patch.

Provider-free verification includes `rule-set-reactivation.integration.spec.ts` on the explicitly named disposable `127.0.0.1:55441/lcsp_reactivation_test`, `tests/rule-set-reactivation-migration.mjs`, and `tests/rule-set-reactivation-http.mjs` (run using the API's tsx after building the API). Tests intentionally create fixture Preparations only in isolated test databases; they do not run models.
