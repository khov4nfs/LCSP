# Rule Validation timeline (Preparation de491791-2e5a-45da-9ff4-2b915de42f07)

Real Rule Validator attempts = 0. The eight RULE_VALIDATION:FAILED events were 5 rejected author_legal_requirement calls and 3 malformed get_claim_inventory reads, all rejected inside the Agent tools before any validator ran.

**First failure.** Ordinal 1 (seq 921, 08:47:59) is a malformed read in CLAIM_INVENTORY_READY, before start_rule_authoring; the first authoring-mutation rejection is ordinal 2 (seq 956).

**Downstream.** Ordinals 2-7 are not consequences of ordinal 1. They share one upstream cause: the frozen inventory held no claim that could ground applicability, so no assessable author_legal_requirement call could succeed.

| # | Time | Tool (arg keys) | Code | Offending object | Runtime label | Real validator ran | Same state as |
|---|---|---|---|---|---|---|---|
| 1 | 08:47:59.687 | `get_claim_inventory` (kind, limit) | CLAIM_SCHEMA_INVALID | tool schema (argument field not recoverable: retained log keeps argument names and size only) | RULE_VALIDATION | no | [4, 8] |
| 2 | 08:48:30.395 | `author_legal_requirement` (applicability_claim_ids, context_claim_ids, operative_claim_ids, qualifier_claim_ids, requirement_key, title) | CLAIM_REQUIREMENT_MISMATCH | DEFINITION claim: The operator controls the covered service. | RULE_VALIDATION | no |  |
| 3 | 08:48:32.739 | `author_legal_requirement` (applicability_claim_ids, context_claim_ids, operative_claim_ids, qualifier_claim_ids, requirement_key, title) | CLAIM_REQUIREMENT_MISMATCH | CONTEXT claim: Configured export software alone does not establish fulfillment of delivery. | RULE_VALIDATION | no |  |
| 4 | 08:48:35.829 | `get_claim_inventory` (kind, limit, offset) | CLAIM_SCHEMA_INVALID | tool schema (argument field not recoverable: retained log keeps argument names and size only) | RULE_VALIDATION | no | [1, 8] |
| 5 | 08:48:43.934 | `author_legal_requirement` (applicability_claim_ids, context_claim_ids, operative_claim_ids, requirement_key, title) | CLAIM_REQUIREMENT_MISMATCH | TEMPORAL_RULE claim: This instrument takes effect on 1 January 2026. | RULE_VALIDATION | no | [6] |
| 6 | 08:48:47.594 | `author_legal_requirement` (applicability_claim_ids, context_claim_ids, operative_claim_ids, requirement_key, title) | CLAIM_REQUIREMENT_MISMATCH | TEMPORAL_RULE claim: This instrument takes effect on 1 January 2026. | RULE_VALIDATION | no | [5] |
| 7 | 08:48:50.201 | `author_legal_requirement` (applicability_claim_ids, operative_claim_ids, requirement_key, title) | CLAIM_SCHEMA_INVALID | reference not recoverable: it was the caller-chosen requirement_key, which the retained telemetry does not keep | RULE_VALIDATION | no |  |
| 8 | 08:48:52.112 | `get_claim_inventory` (kind, limit) | CLAIM_SCHEMA_INVALID | tool schema (argument field not recoverable: retained log keeps argument names and size only) | RULE_VALIDATION | no | [1, 4] |

Every failure carried `requiredAction=get_next_review_unit` (discovery is frozen, so that is not a valid repair), `rule_validation_attempt=0` and an unchanged draft (candidate fingerprint `4da65c9acf00…`, requirement fingerprint `4f53cda18c2b…` = digest of the empty list).

Exact reproduction at HEAD 920d7b3ff: 7 live events compared, gap/state/candidate/requirement fingerprints all equal (see PREFIX_REPRODUCTION.json).
