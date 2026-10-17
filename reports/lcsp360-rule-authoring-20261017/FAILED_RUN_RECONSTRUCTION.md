# Failed run reconstruction

| | |
|---|---|
| preparationId | `de491791-2e5a-45da-9ff4-2b915de42f07` |
| legalSourceVersionId | `6a03921d-97dd-4d6b-ba9a-aa70f331ccfc` |
| correlationId | `e4c32da8-0174-4719-8b7f-a339a673fc8a` |
| idempotencyKey | `rule-set-preparation:6a03921d-97dd-4d6b-ba9a-aa70f331ccfc:attempt:1` |
| outboxEventId | `outbox:4e23ec64260ac83b44a8e6e8616a9514c2a8498c24b2495be3866b9dd9676edf` |
| nativeRunId | `1e70fd92-b1d9-4e38-b3f6-d365e8467e93` |
| threadId | `0359b796-9b7f-545e-b471-5885eb6bc1b6` |
| isolatedStackRun | `733efa6a76efab54` |
| deployedSha | `920d7b3ff08feb9eace81a6264bdbcc57f2c9ac0` |
| checkpoints | `1f1ca063-42e5-6b83-bfff-3f28132fc0a1`, `1f1ca063-42ed-6647-8000-08bd9fede9d4`, `1f1ca063-42f0-6958-8001-c6df9e00c17c`, `1f1ca079-3f99-6dfc-8002-7dc8b67a46cf` |

## Handoff proof
CLAIM_INVENTORY_READY was reached: {"claimInventoryReadyReached": true, "inventoryRevisionCount": 1, "reviewFrontier": {"blocked": 0, "discoveryCompleteEligible": true, "inReview": 0, "pending": 0, "persistedClaims": 38, "reviewedNoClaims": 0, "reviewedWithClaims": 11, "total": 11}, "frozenInventoryFingerprint": "5ebcc5cf95b3d0100b7da80bbd15ae424ac83b7d6392a6769c8f0b0ee1fc6964", "claims": 38, "relations": 14, "ruleSetVersions": 0, "persistedRequirements": 0, "persistedAssessmentRules": 0}

## Root cause (PROVEN)
CLAIM_INVENTORY_READY froze an inventory from which no Rule Set could ever be authored (0 of 38 claims can ground applicability; 17 normative claims), and the Agent tools then rejected every authoring attempt with feedback that was misclassified as Rule Validation and pointed at a discovery tool.

1. **INVENTORY_FREEZE** — validateClaimInventory checked structure, identity and accounting only; it did not check the necessary conditions for any valid Rule Set. Proof of necessity in APPLICABILITY_CONTRACT_ANALYSIS.json.
2. **CLAIM_DISCOVERY** — The Agent authored no SCOPE or CONDITION claim; instructions said "if needed".
3. **OBSERVABILITY** — ClaimInventory.rejected labelled every post-freeze tool rejection RULE_VALIDATION (and every discovery one CLAIM_INVENTORY_VALIDATION), so 8 rejections read as 8 validator failures with attempt counter 0.
4. **FEEDBACK** — Rejections carried requiredAction get_next_review_unit, no claim role, no expected argument and no applicability candidates. The rejected claims were a DEFINITION, a CONTEXT and a TEMPORAL_RULE claim (which argument each was placed in is not retained; every authoring call carried applicability_claim_ids), and the last call reference is consistent with an empty applicability list, which the pre-fix tool rejects.

Why deterministic tests missed it: No test asked whether a frozen inventory could be authored from; fixtures always carried a CONDITION claim, and tool rejections were never counted separately from validator runs.

## Why persisted counts stayed zero
C: every authoring mutation was rejected inside the tool before the draft was stored (draft candidate fingerprint constant at 4da65c9a… across all eight events; requirement fingerprint constant at the digest of the empty list). The draft is Agent run-context state until submission, so the monitor (persisted rows) and the draft agree: 0.

## No-progress
VALID mechanical detection, root-caused upstream; not weakened. Fingerprint `d71eaf10b6a78d99410a6e946422e175174a90b24134bafd55367a4df15c5824`. identical state at events 1, 4 and 8; warned at 4, terminal at 8. The repeated read is not a wrongly detected loop: same gap, same unchanged draft, one warning. The defect is that the Agent could not make progress by any other route.

## Contract answers
- **packetSize**: No giant packet: author_legal_requirement/author_assessment_rule are typed incremental upserts by key. The failures are not whole-packet repair instability.
- **feedbackLocality**: Local (ref = the offending claim) but not actionable: no role, no expected argument, wrong requiredAction.
- **draftMutationModel**: incremental canonical mutation, keyed upsert, rejected before storage
- **monotonicValidation**: Not applicable: the real validator never ran; accepted requirements are stored untouched by later rejections (tested).
- **semanticVsBookkeeping**: Role bucket choice is bookkeeping derivable from claim type and is now reported by get_claim_inventory (accountingRole) and in every mismatch; which claims aggregate into a Requirement and applicability grounding stay Agent decisions.

## The eight failures
See RULE_VALIDATION_TIMELINE.md.

## Accounting (PARTIAL)
{"logicalCalls": 160, "logicalCompletions": 160, "observedPhysicalProviderAttempts": 436, "failedProviderAttempts": 276, "fallbackCalls": 88, "summarizationCalls": 0, "usage": {"usageBearing": 160, "inputTokens": 2736748, "outputTokens": 26493, "knownTotalTokens": 2763241, "cacheReadTokens": 1982711, "cacheWriteTokens": 0}, "accounting": "PARTIAL"}

## Limits
The retained telemetry keeps tool names, argument KEYS and sizes but not argument values or tool result text; the exact limit/kind values of the three malformed reads and the requirement_key of ordinal 7 are therefore not recoverable and are marked as such.
