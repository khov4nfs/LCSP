# Artifact, Wizard, and Conflict Tool Tasks

Status: PARTIALLY_SUPERSEDED_FOR_ACTIVE_MVP
Stories: AO-3 — Missing-Input Orchestration; AO-4 — Wizard Target Verification  
Template: `agentic-tool-implementation-task-template.md`

`get_verified_profile` and any VerifiedProfile approval-dependent path are retired from the active Managed Deep Agents runtime. The remaining artifact/wizard/conflict read tools are historical AO-4 context unless revalidated against the direct EngineeringRule flow.

| Task ID / tool | Implementation instruction | Typed result and safety boundary | Required verification |
|---|---|---|---|
| `TASK-AO-4-01-get-assessment-context` / `get_assessment_context` | Read submitted wizard answers, target IDs, and pinned artifact versions within assessment scope. | User-owned input projection; no autonomous update. | PBAC, version pin, redacted fields. |
| `TASK-AO-4-02-compare-wizard-claim` / `compare_wizard_claim` | Compare one typed target against bounded AO-2 evidence and coverage. | `SUPPORTED`/`CONTRADICTED`/`NOT_FOUND`/`UNKNOWN`/`OUT_OF_COVERAGE` with refs. | Golden verdicts; no inference when coverage is limited. |
| `TASK-AO-4-03-propose-missing-targets` / `propose_missing_targets` | Produce bounded evidence-backed candidates from verified patterns. | Proposal only; distinct from target/claim. | Candidate limit, no wizard mutation, evidence trace. |
| `TASK-AO-4-04-get-artifact-chain` / `get_artifact_chain` | Resolve immutable EvidenceReport → profile → flow → conflict → verified-profile refs. | Version chain/ref integrity only. | Missing/stale link becomes typed limitation. |
| `TASK-AO-4-05-get-reconciliation-context` / `get_reconciliation_context` | Read conflict evidence and permitted resolution paths. | Conflict context; cannot resolve material conflict. | Conflict isolation and permitted-path enforcement. |
| `TASK-AO-4-06-get-verified-profile` / `get_verified_profile` | Read reconciled versioned profile only after owning gates. | Pinned legal-matching input or block reason. | Rejected/unapproved profile denial. |

## Definition of Done

- Wizard source of truth is preserved; all modifications remain explicit human/workflow actions outside these read tools.
- AO-3 routes missing context through the catalog resolver map rather than invoking unlisted tools.

## Executable Tool Packets

All packets inherit [shared-tool-contract.md](shared-tool-contract.md). They read `WizardProfile`, accepted evidence projections, `AIUsageFlow`, `ConflictRecord`, and `VerifiedProfile` through the API PBAC boundary; UI is presentation-only.

### `get_assessment_context`

- **Input/output:** `{include:{submittedAnswers,targetIds,pinnedArtifacts},answerFields?}` with allow-listed answer fields → `{wizard:{id,version,status,submittedAt,answers,targetIds},artifactVersions}`.
- **Execution/LLM:** require submitted profile, ownership and exact version; project only selected redacted typed answers. LLM must issue AO-3 requirement when field/version is missing, never take latest or alter an answer.
- **Failure/tests:** missing/unsubmitted/mismatched profile is typed limitation. Test org isolation, field redaction, submitted state and pin preservation.

### `compare_wizard_claim`

- **Input/output:** `{wizardProfileId,version,targetId,claimField,expectedValue,evidenceArtifactVersion,comparisonScope,maxEvidenceRefs}` → `{verdict:SUPPORTED|CONTRADICTED|NOT_FOUND|UNKNOWN|OUT_OF_COVERAGE,comparedAttributes,evidenceRefs,coverageState,missingEvidenceExplanation,conflictCandidateRef?}`.
- **Execution/LLM:** deterministic typed attribute comparison through bounded AO-2 calls; `NOT_FOUND` only after exhaustive sufficient search. A contradiction creates proposal reference only; LLM reports verdict and cannot mutate Wizard.
- **Failure/tests:** limited/dynamic/ambiguous data gives `UNKNOWN`/`OUT_OF_COVERAGE`. Golden-test all verdicts, unchanged original answer, conflict candidate and correlation chain.

### `propose_missing_targets`

- **Input/output:** `{evidenceArtifactVersion,candidateKinds,seedRefs?,excludeTargetIds,maxResults}` → scored stable candidates with typed attributes, algorithm version, refs, coverage and exclusions.
- **Execution/LLM:** group verified patterns/fingerprints not represented by submitted targets and sort deterministically. Candidate is neither verified target nor wizard write; any persistence is a new append-only proposal entity.
- **Failure/tests:** insufficient coverage produces limitation, not candidate overclaim. Test exclusion of declared targets, order/limit, trace, similar-but-unverified and no wizard writes.

### `get_artifact_chain`

- **Input/output:** `{anchor:{assessmentId|artifactRef},requiredStages?,exactVersions?}` → ordered evidence/profile/flow/conflict/verified-profile safe refs, status/version/provenance, missing/stale links.
- **Execution/LLM:** follow immutable relations only; no payload hydration. LLM uses returned refs to pin downstream call inputs.
- **Failure/tests:** missing/stale/cross-assessment link is a typed limitation. Test valid chain, tenant isolation, version integrity and missing stage.

### `get_reconciliation_context`

- **Input/output:** `{aiUsageFlowId|conflictIds,statuses?,maxResults}` → bounded conflict `{id,type,score,explanation,evidenceRefs,status}`, allowed resolution paths, artifact refs.
- **Execution/LLM:** query scoped conflicts and policy-approved paths only. LLM may emit `CONFLICT` and route; it cannot resolve material conflict or read sensitive notes.
- **Failure/tests:** unknown/out-of-scope conflict is non-leaking. Test state/path filtering, open conflict blocks verified profile, pagination and PBAC.

### `get_verified_profile`

- **Input/output:** `{verifiedProfileId,expectedVersion?,requiredFor:LEGAL_MATCHING|CLASSIFICATION}` → `{profileRef,status,mergedProfile:legalSafeFacts,factEvidenceRefs,evidenceRefs,gatesPassedAt,blockingReason?}`.
- **Execution/LLM:** require approved/eligible state, exact version, no unresolved conflict and ref integrity; do not reuse an unprotected mapper directly. LLM may use returned facts only for the named legal step.
- **Failure/tests:** pending/rejected/stale/open-conflict profile is blocked/limited. Test tenant isolation, version mismatch, reference integrity and gate state.
