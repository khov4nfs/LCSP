# Applicability contract analysis

Retained frozen inventory `5ebcc5cf95b3d0100b7da80bbd15ae424ac83b7d6392a6769c8f0b0ee1fc6964` of failed Preparation `de491791-2e5a-45da-9ff4-2b915de42f07` (38 claims, 14 relations).

## Verdict
Applicability is a first-class, claim-authoritative source proposition (SCOPE / CONDITION), authored by Claim Discovery before the freeze. The structured actor is an addressee LABEL on the operative proposition, not applicability. The defect is that the freeze did not require authoring capability.

Rejected: B (pure structured projection): not equivalent, see questions 2 and 5; C (hybrid): its second leg (projection) has no sound deterministic source in this fixture

## Why the frozen inventory cannot satisfy the contract
Zero of 38 claims have type CONDITION or SCOPE, so the role matrix offers no claim for APPLICABILITY_CONDITION. Every assessable author_legal_requirement call therefore fails, independently of how the Agent fills the other role arguments. Replay proof: the ideal Agent (perfect role buckets) had 0 of 17 normative claims accepted (PREFIX_REPRODUCTION.json idealAgentInfeasibility).

## Necessity proof (why the readiness gate is sound)
1. A submitted Rule Set needs packet.assessmentRules.length >= 1 (compliance-rule-set-integrity.validator.ts:105-110 EMPTY_RULE_SET).
2. An AssessmentRule must link an assessable LegalRequirement (coverage COVERED_BY_ASSESSMENT_RULES, INCOMPLETE_RULE_COVERAGE otherwise).
3. An assessable LegalRequirement needs a non-empty applicabilityConditions list (declaresApplicabilityScope, applicability.ts:143; APPLICABILITY_SCOPE_MISSING at compliance-rule-set-integrity.validator.ts:416-428).
4. Every applicabilityConditions[i] must equal the statement of a claim bound with role APPLICABILITY_CONDITION (semantic-claim-integrity.validator.ts:346 and :391-399 "has no claim authority").
5. The role matrix grants APPLICABILITY_CONDITION only to CONDITION and SCOPE claims (semantic-claim-integrity.validator.ts:35-36).
6. Therefore an inventory with no relevant SCOPE/CONDITION claim can never yield a valid Rule Set, whatever the Agent does after the freeze. The readiness gate rejects only inventories that are already provably unauthorable, so it cannot reject a legitimate future.

## The five questions
**1_is_applicability_absent_from_source_interpretation**

No. The source states it, but not as applicability-bearing claims: the addressee label is in operative.actor on all 17 normative claims; triggers are embedded in the statements of a904a30b, e68ff98e, c66f0063, 11cc55af, ec585d27 and as action-embedded start/request triggers in 14b91c88 and bfe5c0e8; defined-role criteria are in 4 DEFINITION claims; time scoping is in 2 TEMPORAL_RULE claims. None of it is expressed as a SCOPE or CONDITION claim.

**2_is_it_present_structurally_but_lost_because_only_SCOPE_CONDITION_are_recognised**

Only the addressee LABEL is structural. The domain contract (LegalRequirement.applicabilityConditions) says "a label is never its own explanation": when the source names a role and defines its criteria, those criteria must be unpacked and cited. Here the labels are defined terms (covered service, operator, fulfillment provider: DEFINITION claims 2d1a3847, 5c10d55e, 4e9e6e74, 504a4226), so projecting operative.actor would emit exactly the unexplained label the contract forbids. Triggers inside prose cannot be extracted without interpreting prose, which no validator or runtime step may do. Definitions may not be counted as applicability.

**3_did_claim_discovery_fail_to_emit_required_applicability_semantics**

Yes. instructions.md told the Agent to register SCOPE/CONDITION claims "if needed"; it registered none (0 of 38) although it authored 17 normative claims, 4 defined-role definitions and at least 5 conditional or triggered duties. A previous live run of the same fixture class (94773fa8) did register 2 SCOPE and 2 CONDITION claims of 35, so the omission is run-level variance in Agent output, not an impossible contract. The earlier run never reached Rule authoring, so it does not prove those claims were sufficient.

**4_did_the_domain_schema_encode_applicability_too_narrowly**

No. Every Requirement field that evidence tests (applicabilityConditions, qualifiers, exceptions, semanticContext) requires claim authority by design (semantic-claim-integrity.validator.ts), so the runtime never classifies prose. The narrow point is only the gate placement: CLAIM_INVENTORY_READY did not check a condition that is NECESSARY for every valid Rule Set (see necessityProof).

**5_is_rule_authoring_wrongly_requiring_a_standalone_applicability_claim**

No. The structured bindings do not provide equivalent semantics (question 2) and a projection would create a second authority path for the same field. Equivalent provenance exists only when the Agent has interpreted the source into a claim.

## Current contract trace

| Step | File | Symbol | Check |
|---|---|---|---|
| Agent tool | `deepagents/rule_set_preparation/claim_tools.py` | `requirement (author_legal_requirement)` (L313) | rejects `not non_assessable_reason and not applicability_claim_ids` with CLAIM_SCHEMA_INVALID; claims must sit in the bucket matching CLAIM_ROLES (line 298) else CLAIM_REQUIREMENT_MISMATCH |
| Role matrix (Agent mirror) | `deepagents/rule_set_preparation/claim_inventory.py` | `CLAIM_ROLES`  | CONDITION and SCOPE -> APPLICABILITY_CONDITION; DEFINITION -> DEFINITION; TEMPORAL_RULE -> QUALIFIER; CONTEXT -> CONTEXT |
| API claim authority | `apps/api/src/modules/compliance-rule-set/domain/semantic-claim-integrity.validator.ts` | `allowedRoles / validateSemanticClaimGraph` (L35-36, 318, 346, 391-399) | only CONDITION and SCOPE may take APPLICABILITY_CONDITION; each applicabilityConditions[i] must equal that claim statement |
| API applicability declaration | `apps/api/src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.ts` | `declaresApplicabilityScope` (L416-428) | an assessable requirement needs a non-empty applicabilityConditions list (APPLICABILITY_SCOPE_MISSING) |
| Packet contract | `packages/contracts/src/compliance-rule-set/schemas.ts` | `legalRequirementSchema.applicabilityConditions` (L181) | "a label is never its own explanation"; "if the source adds no further condition, state the addressee it names" |
| AssessmentRule projection | `packages/contracts/src/compliance-rule-set/applicability.ts` | `deriveAssessmentApplicabilityGuidance`  | copies parent Actor/Modality/Action and each Applicability condition separately; never regenerates a customer applicability predicate |
| Assessment Root consumer | `deepagents/assessment_root/tools.py` | `_applicability_elements` (L387) | tests each applicabilityConditions[index] with a finding; the actor is not one of those testable elements |
| Completion Gate | `apps/api/src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.ts` | `validateComplianceRuleSetPacket`  | re-runs the same validators on the submitted packet; no separate applicability rule |
| Freeze gate (pre-fix) | `apps/api/src/modules/compliance-rule-set/domain/claim-inventory.ts` | `validateClaimInventory`  | validated structure, identity and accounting only: nothing checked authoring capability, so the 38-claim inventory froze |

## Precedent

4 of 35 claims; two are mis-typed. Evidence that discovery can emit applicability-typed claims, not evidence of sufficient quality.

## Disposition
**Before:** The 38-claim inventory froze (CLAIM_INVENTORY_READY) and author_legal_requirement could produce no assessable Requirement: reproduced deterministically (PREFIX_REPRODUCTION.json; live gap and state fingerprints matched exactly).

**After:** OPTION A: finalize_semantic_claim_inventory rejects the exact retained claims with 17 machine-readable APPLICABILITY_AUTHORITY_MISSING gaps (one per normative claim, with claim type and owning source node) and does not freeze. A scripted repaired discovery (6 source-grounded SCOPE/CONDITION claims added through the real tools) then freezes, authors 9 Requirements and 8 AssessmentRules, passes the real Rule Validator on its first attempt (44/44 claims accounted) and submits.

## Per-claim classification

| Claim | Type | Role | Node | Actor | Addressee label only | Embedded trigger (analyst) | Same-node qualifiers/temporal/exceptions | Relations |
|---|---|---|---|---|---|---|---|---|
| `2c5ec6df` | DEFINITION | DEFINITION | chapter/i/article/1 |  |  |  |  | DEFINITION<-e68ff98e |
| `2d1a3847` | DEFINITION | DEFINITION | chapter/i/article/1 |  |  |  |  |  |
| `4e9e6e74` | DEFINITION | DEFINITION | chapter/i/article/1 |  |  |  |  |  |
| `5c10d55e` | DEFINITION | DEFINITION | chapter/i/article/1 |  |  |  |  |  |
| `0feb5e44` | CONTEXT | CONTEXT | chapter/i/article/2/paragraph/1 |  |  |  |  | CONDITION<-e33095b2 |
| `14b91c88` | DUTY | OPERATIVE_PROPOSITION | chapter/i/article/2/paragraph/1 | operator of a covered service | yes | for a requesting customer (action-embedded request trigger) |  | INCORPORATES<-e68ff98e CONDITION<-5800187c CROSS_REFERENCE<-c66f0063 CROSS_REFERENCE<-7f5c9953 |
| `bfe5c0e8` | DUTY | OPERATIVE_PROPOSITION | chapter/i/article/2/paragraph/1 | operator of a covered service | yes | after receiving the request (action-embedded start trigger) |  | EXCEPTION<-68449a39 CONDITION<-a904a30b CONDITION<-8391d3e7 |
| `6d142dd4` | PROHIBITION | OPERATIVE_PROPOSITION | chapter/i/article/2/paragraph/2 | operator | yes |  | a4f6de36:QUALIFIER | EXCEPTION->68449a39 EXCEPTION<-68449a39 CONDITION<-5800187c CONDITION<-8391d3e7 |
| `a4f6de36` | QUALIFIER | QUALIFIER | chapter/i/article/2/paragraph/2 |  |  |  |  |  |
| `5cae9cc6` | CONTEXT | CONTEXT | chapter/i/article/3/paragraph/1 |  |  |  |  |  |
| `a904a30b` | DUTY | OPERATIVE_PROPOSITION | chapter/i/article/3/paragraph/1 | operator | yes | If failure to perform Article 2(1) causes a customer documented financial loss |  | CONDITION->bfe5c0e8 |
| `68449a39` | EXCEPTION | EXCEPTION | chapter/i/article/3/paragraph/2 |  |  |  | 6bd22b6c:QUALIFIER c02a699b:QUALIFIER | EXCEPTION->bfe5c0e8 EXCEPTION->6d142dd4 EXCEPTION<-6d142dd4 |
| `6bd22b6c` | QUALIFIER | QUALIFIER | chapter/i/article/3/paragraph/2 |  |  |  | c02a699b:QUALIFIER 68449a39:EXCEPTION |  |
| `c02a699b` | QUALIFIER | QUALIFIER | chapter/i/article/3/paragraph/2 |  |  |  | 6bd22b6c:QUALIFIER 68449a39:EXCEPTION |  |
| `5800187c` | TEMPORAL_RULE | QUALIFIER | chapter/ii/article/4 |  |  |  | 8391d3e7:TEMPORAL_RULE e33095b2:TEMPORAL_RULE | CONDITION->14b91c88 CONDITION->6d142dd4 |
| `8391d3e7` | TEMPORAL_RULE | QUALIFIER | chapter/ii/article/4 |  |  |  | 5800187c:TEMPORAL_RULE e33095b2:TEMPORAL_RULE | CONDITION->6d142dd4 CONDITION->bfe5c0e8 |
| `e33095b2` | TEMPORAL_RULE | QUALIFIER | chapter/ii/article/4 |  |  |  | 5800187c:TEMPORAL_RULE 8391d3e7:TEMPORAL_RULE | CONDITION->0feb5e44 |
| `d5bc695a` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/5 | operator | yes |  |  |  |
| `e68ff98e` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/5 | external fulfillment provider | yes | When an operator delegates export fulfillment to an external fulfillment provider |  | INCORPORATES->14b91c88 DEFINITION->2c5ec6df INCORPORATES<-7f5c9953 |
| `a791994f` | CONTEXT | CONTEXT | chapter/ii/article/6/paragraph/1 |  |  |  |  |  |
| `101a0cea` | DEFINITION | DEFINITION | chapter/ii/article/6/paragraph/1 |  |  |  |  |  |
| `bfba28a9` | DEFINITION | DEFINITION | chapter/ii/article/6/paragraph/1 |  |  |  |  |  |
| `01d14195` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/6/paragraph/2 | Operator of a covered service | yes |  | 9b86ca7d:QUALIFIER |  |
| `aeb9979f` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/6/paragraph/2 | Operator of a covered service | yes |  | 9b86ca7d:QUALIFIER |  |
| `d0139643` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/6/paragraph/2 | Operator of a covered service | yes |  | 9b86ca7d:QUALIFIER |  |
| `f6174e86` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/6/paragraph/2 | Operator of a covered service | yes |  | 9b86ca7d:QUALIFIER |  |
| `9b86ca7d` | QUALIFIER | QUALIFIER | chapter/ii/article/6/paragraph/2 |  |  |  |  |  |
| `8ff8747d` | CONTEXT | CONTEXT | chapter/ii/article/7 |  |  |  |  |  |
| `dae2788c` | CONTEXT | CONTEXT | chapter/ii/article/7 |  |  |  |  |  |
| `504a4226` | DEFINITION | DEFINITION | chapter/ii/article/7 |  |  |  |  |  |
| `7f5c9953` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/7 | B (fulfillment provider) | yes |  |  | INCORPORATES->e68ff98e CROSS_REFERENCE->14b91c88 |
| `c66f0063` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/7 | A (covered-service operator) | yes | If A delegates export fulfillment to B |  | CROSS_REFERENCE->14b91c88 |
| `6d923c65` | PERMISSION | OPERATIVE_PROPOSITION | chapter/ii/article/7 | Auditor | yes |  |  |  |
| `70758db8` | PERMISSION | OPERATIVE_PROPOSITION | chapter/ii/article/7 | Customer | yes |  |  |  |
| `e49c7f83` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/8 | operator of a covered service | yes |  | 28e0956c:QUALIFIER |  |
| `ec585d27` | DUTY | OPERATIVE_PROPOSITION | chapter/ii/article/8 | operator of a covered service | yes | when that condition ceases (termination trigger) | 28e0956c:QUALIFIER |  |
| `11cc55af` | PERMISSION | OPERATIVE_PROPOSITION | chapter/ii/article/8 | operator of a covered service | yes | only while a documented, specific security incident makes access unsafe | 28e0956c:QUALIFIER |  |
| `28e0956c` | QUALIFIER | QUALIFIER | chapter/ii/article/8 |  |  |  |  |  |
