# Assessment Lifecycle Spec

## Status

AUTHORITATIVE

## Purpose

Single source of truth for the evidence-to-output assessment lifecycle after Repository Scan evidence exists: TechnicalProfile, AIUsageFlow context, conflict reconciliation, direct EngineeringRule Risk Classification, Gap Analysis, Document Generation, and state handoffs.

## Lifecycle

```text
Assessment
-> WizardProfile
-> RepositorySnapshot
-> TechnicalEvidenceReport
-> TechnicalProfile
-> AIUsageFlow
-> Conflict Reconciliation when required
-> EngineeringRule Assessment
-> Risk Classification
-> Gap Analysis
-> Document Generation
```

## Invariants

- TechnicalProfile is derived from TechnicalEvidenceReport after schema and quality gates.
- AIUsageFlow uses WizardProfile, TechnicalProfile, TechnicalFinding[], graph paths, and coverage limitations.
- Every material AIUsageFlow claim requires evidence refs.
- Reconciliation compares WizardProfile, TechnicalProfile, and AIUsageFlow when business context exists.
- Unresolved conflict blocks classification.
- Direct EngineeringRule evaluation with legal-rule provenance and citation traceability is mandatory before classification can be final.
- Gap Analysis is mandatory between completed classification and document generation.
- Manager is the MVP final resolver.
- Developer absence must not block assessment lifecycle transitions.

## AIUsageFlow Contract Summary

AIUsageFlow records business process, AI purpose, input/output types, downstream action, affected subjects, human review, automation level, harm category, evidence refs, confidence, and uncertainty reasons.

Provider/model/framework detection alone is insufficient. Unknown critical usage purpose blocks or degrades downstream output.

## Reconciliation Contract Summary

Scanner evidence is immutable. Manager resolution is stored separately and audited. Conflict creates Manager Conflict Resolution Task. Direct EngineeringRule classification starts only when conflicts are resolved or no conflict exists.

## State Machine Summary

Classification is denied until direct EngineeringRule evaluation has evidence refs and legal-rule provenance. Final document generation is denied when unresolved conflict or missing citation remains.

<!-- PHASE-5-5-AIUSAGEFLOW-TECHNICALPROFILE:START -->

## Phase 5.5 Canonical TechnicalProfile Contract

### TechnicalProfile Fields

```ts
export interface TechnicalProfile {
  technicalProfileId: string
  assessmentId: string
  technicalEvidenceReportId: string
  source: 'GITHUB_REPOSITORY_SCAN'
  aiDetected: 'none' | 'possible' | 'confirmed'
  providers: string[]
  frameworks: string[]
  modelInvocationCount: number
  inputCategories: string[]
  outputCategories: string[]
  decisionFlowSignals: string[]
  humanReviewSignals: string[]
  sensitiveDataSignals: string[]
  domainSignals: string[]
  coverageLimitations: CoverageLimitation[]
  confidence: number
  evidenceRefs: EvidenceRef[]
  createdAt: string
}
```

### Aggregation Rules

- Provider package only sets `aiDetected = 'possible'`, not confirmed.
- Model invocation sets `aiDetected = 'confirmed'`.
- Downstream decision requires AI output plus branch/action path evidence.
- Human review present requires explicit review workflow evidence.
- Unknown fields preserve coverage limitation refs instead of being guessed.

## Phase 5.5 Canonical AIUsageFlow Rule Engine Contract

### Interfaces

```ts
export interface EvidenceRef {
  evidenceRefId: string
  evidenceRef: string
  sourceType: 'STATIC_SCAN' | 'WIZARD_DECLARATION' | 'MANAGER_RESOLUTION' | 'LEGAL_CORPUS' | 'SYSTEM_DERIVED'
  sourceFileId?: string
  relativePath?: string
  location?: {
    startLine?: number
    startColumn?: number
    endLine?: number
    endColumn?: number
    symbolRef?: string
  }
  evidenceHash: string
  redactionStatus: 'NO_SOURCE_STORED' | 'REDACTED_METADATA_ONLY'
  findingId?: string
}

export interface ConfidenceBreakdown {
  base: number
  requiredEvidenceBonus: number
  optionalSupportBonus: number
  coveragePenalty: number
  conflictPenalty: number
  missingRequiredEvidencePenalty: number
  final: number
}

export interface AIUsageFlowInput {
  assessmentId: string
  wizardProfileId: string
  technicalProfileId: string
  technicalEvidenceReportId: string
  findings: TechnicalFinding[]
  evidenceRefs: EvidenceRef[]
  coverageLimitations: CoverageLimitation[]
}

export interface AIUsageFlowClaim {
  claimId: string
  field: 'business_process' | 'ai_purpose' | 'ai_input_types' | 'ai_output_types' | 'downstream_action' | 'affected_subjects' | 'human_review' | 'automation_level' | 'potential_harm_categories' | 'coverage_limitation' | 'conflict'
  value: unknown
  evidenceRefs: EvidenceRef[]
  confidence: number
  confidenceBreakdown: ConfidenceBreakdown
  uncertaintyReasons: string[]
}

Persistence rule: `AIUsageFlowClaim.evidenceRefs` is many-to-many. The canonical Prisma representation is `AIUsageFlowClaim` plus `AIUsageFlowClaimEvidenceReference`; material claims must not be collapsed to a single `evidenceRefId`.

export interface RuleContext {
  input: AIUsageFlowInput
  claims: AIUsageFlowClaim[]
  conflicts: RuleResult[]
  abstentions: RuleResult[]
}

export interface RuleResult {
  ruleId: string
  matched: boolean
  claims: AIUsageFlowClaim[]
  conflictType?: string
  abstentionReason?: string
  coverageLimitation?: CoverageLimitation
}

export interface AIUsageFlowRule {
  ruleId: string
  description: string
  requiredFindingTypes: string[]
  optionalSupportingEvidence: string[]
  outputClaimField: AIUsageFlowClaim['field']
  confidenceImpact: number
  abstentionBehavior: string
  conflictBehavior: string
  evaluate(context: RuleContext): RuleResult
}
```

### Rule Execution Order

1. Provider and invocation rules.
2. Input category rules.
3. Output type rules.
4. Downstream action rules.
5. Human review rules.
6. Automation level rules.
7. Business process rules.
8. Affected subject rules.
9. Harm category rules.
10. Conflict rules.
11. Abstention and coverage limitation rules.

### Minimum Canonical Rule Catalog

| Rule ID | Input findings required | Optional supporting evidence | Output claim field | Confidence impact | Abstention behavior | Conflict behavior |
| --- | --- | --- | --- | ---: | --- | --- |
| AUF-001 Provider package only | `AI_PROVIDER_USAGE` | manifest/package evidence | `coverage_limitation` | -0.20 | abstain from confirmed AI usage | none |
| AUF-002 Provider invocation detected | `AI_MODEL_INVOCATION` | provider import/call evidence | `ai_purpose` | +0.25 | none | conflicts with no-AI wizard declaration |
| AUF-003 Model output variable detected | `AI_OUTPUT_SIGNAL` | variable/call return evidence | `ai_output_types` | +0.15 | none | none |
| AUF-004 Financial input detected | `SENSITIVE_DATA_SIGNAL` | field names/schema refs | `ai_input_types` | +0.15 | unknown if weak evidence | none |
| AUF-005 Employment input detected | `DOMAIN_CONTEXT_SIGNAL` | HR field/route refs | `ai_input_types` | +0.15 | unknown if weak evidence | none |
| AUF-006 Health input detected | `SENSITIVE_DATA_SIGNAL` | health field/route refs | `ai_input_types` | +0.15 | unknown if weak evidence | none |
| AUF-007 Education input detected | `DOMAIN_CONTEXT_SIGNAL` | education field/route refs | `ai_input_types` | +0.10 | unknown if weak evidence | none |
| AUF-008 Personal data input detected | `SENSITIVE_DATA_SIGNAL` | PII field refs | `ai_input_types` | +0.10 | unknown if weak evidence | none |
| AUF-009 Score output detected | `AI_OUTPUT_SIGNAL` | numeric score variable refs | `ai_output_types` | +0.15 | none | none |
| AUF-010 Ranking output detected | `RANKING_SIGNAL` | sort/rank path refs | `ai_output_types` | +0.20 | none | none |
| AUF-011 Summary output detected | `AI_OUTPUT_SIGNAL` | summary/description refs | `ai_output_types` | +0.10 | none | none |
| AUF-012 Decision label output detected | `AI_OUTPUT_SIGNAL` | label/classification refs | `ai_output_types` | +0.15 | none | none |
| AUF-013 Output feeds threshold branch | `AI_DECISION_FLOW_SIGNAL` | branch condition refs | `downstream_action` | +0.25 | abstain if output path dynamic | none |
| AUF-014 Output triggers approve/reject | `AUTOMATED_DECISION_SIGNAL` | approve/reject action refs | `downstream_action` | +0.30 | abstain if action target unknown | none |
| AUF-015 Output triggers status update | `STATUS_UPDATE_SIGNAL` | persistence action refs | `downstream_action` | +0.25 | abstain if status target unknown | none |
| AUF-016 Output displayed to user only | `USER_IMPACT_SIGNAL` | response rendering refs | `downstream_action` | +0.10 | none | conflicts with wizard automated decision claim if no action evidence |
| AUF-017 Human review present | `HUMAN_REVIEW_SIGNAL` | review queue/approval refs | `human_review` | +0.25 | none | none |
| AUF-018 Human review absent with bounded path | `AUTOMATED_DECISION_SIGNAL` | complete bounded path refs | `human_review` | +0.20 | abstain if path incomplete | conflicts with human-review wizard claim |
| AUF-019 Human review unclear | `UNSUPPORTED_DYNAMIC_FLOW` | coverage limitation refs | `human_review` | -0.20 | require unclear state | none |
| AUF-020 Loan approval context | `DOMAIN_CONTEXT_SIGNAL` | loan/credit refs | `business_process` | +0.20 | unknown if only text hint | none |
| AUF-021 Recruitment context | `DOMAIN_CONTEXT_SIGNAL` | candidate/job refs | `business_process` | +0.20 | unknown if only text hint | none |
| AUF-022 Healthcare context | `DOMAIN_CONTEXT_SIGNAL` | patient/medical refs | `business_process` | +0.20 | unknown if only text hint | none |
| AUF-023 Customer support context | `USER_IMPACT_SIGNAL` | chat/support refs | `business_process` | +0.10 | none | none |
| AUF-024 Internal productivity context | `DOMAIN_CONTEXT_SIGNAL` | internal tool refs | `business_process` | +0.10 | none | none |
| AUF-025 Fully automated decision | `AUTOMATED_DECISION_SIGNAL` | output + action + no human review refs | `automation_level` | +0.30 | block if missing output/action link | none |
| AUF-026 Semi-automated decision | `AI_DECISION_FLOW_SIGNAL` + `HUMAN_REVIEW_SIGNAL` | review refs | `automation_level` | +0.20 | unknown if review path unclear | none |
| AUF-027 Assistive usage | `AI_MODEL_INVOCATION` | no downstream action, display/summary refs | `automation_level` | +0.10 | abstain if downstream unknown | none |
| AUF-028 Financial harm potential | financial input + decision action | loan/credit refs | `potential_harm_categories` | +0.20 | block if evidence missing | none |
| AUF-029 Employment discrimination harm potential | employment input + ranking/decision | HR refs | `potential_harm_categories` | +0.20 | block if evidence missing | none |
| AUF-030 Provider only abstention | `AI_PROVIDER_USAGE` only | package evidence | `coverage_limitation` | -0.30 | must abstain from legal matching eligibility | none |
| AUF-031 Dynamic flow limitation | `UNSUPPORTED_DYNAMIC_FLOW` | dynamic import/runtime config refs | `coverage_limitation` | -0.25 | mark unknown/unclear | none |
| AUF-032 Wizard conflict: no AI but invocation exists | `AI_MODEL_INVOCATION` | wizard no-AI declaration | `conflict` | -0.20 | none | create reconciliation conflict |
| AUF-033 Wizard conflict: human review claimed but absent | `AUTOMATED_DECISION_SIGNAL` | wizard human-review claim | `conflict` | -0.20 | none | create reconciliation conflict |
| AUF-034 Wizard conflict: internal-only but customer-facing evidence | `USER_IMPACT_SIGNAL` | wizard internal-only claim | `conflict` | -0.15 | none | create reconciliation conflict |
| AUF-035 Wizard conflict: content-only but scoring/ranking/decision found | `RANKING_SIGNAL` or `AUTOMATED_DECISION_SIGNAL` | wizard content-only claim | `conflict` | -0.20 | none | create reconciliation conflict |
| AUF-036 Customer affected subject | `USER_IMPACT_SIGNAL` | customer/user route or response refs | `affected_subjects` | +0.15 | unknown if only generic UI evidence exists | conflicts with internal-only wizard claim |
| AUF-037 Applicant or employee affected subject | `DOMAIN_CONTEXT_SIGNAL` | candidate/employee route, DTO or entity refs | `affected_subjects` | +0.15 | unknown if domain evidence is weak | conflicts with no affected-subject wizard claim |
| AUF-038 Patient or student affected subject | `DOMAIN_CONTEXT_SIGNAL` or `SENSITIVE_DATA_SIGNAL` | patient/student field, route or entity refs | `affected_subjects` | +0.15 | unknown if domain evidence is weak | conflicts with no affected-subject wizard claim |
| AUF-039 Internal staff only affected subject | `DOMAIN_CONTEXT_SIGNAL` | internal admin/staff-only route refs | `affected_subjects` | +0.05 | unknown if user-facing evidence also exists | conflicts with customer-facing evidence |
| AUF-040 Health or education harm potential | health/education input + decision/recommendation path | domain refs | `potential_harm_categories` | +0.20 | block if evidence missing | none |
| AUF-041 Material claim evidence eligibility | material claim field | one or more evidence refs | `coverage_limitation` | +0.00 | claim is not legal-matching eligible without evidence refs | none |
| AUF-042 Material claim missing evidence blocks legal matching | material claim field without evidence refs | none | `coverage_limitation` | -0.35 | must block legal matching eligibility for that claim | create blocking reason if claim is needed for classification |

Every material claim used for legal matching must carry at least one `EvidenceRef`. Provider/model/framework detection alone never makes a claim eligible for legal matching.

**Wizard-conflict precondition**: The "Conflict Behavior" column for AUF-032 through AUF-039 (and any other rule whose conflict behavior references a wizard declaration, e.g. "conflicts with no-AI wizard declaration", "conflicts with internal-only wizard claim") only applies when a `WizardProfile` is linked to the assessment. When `WizardProfile` is absent, these rules still compute their base output claim field (`business_process`, `human_review`, `affected_subjects`, etc.) from technical evidence alone at the confidence impact listed, but they never generate a conflict candidate — there is no Wizard declaration to conflict with. See `docs/specs/ai-usage-flow-domain-spec.md` `verificationSource: TECHNICAL_ONLY` behavior.

### Confidence Calculation Rules

`docs/specs/ai-usage-flow-domain-spec.md` is the sole authoritative source for AIUsageFlow claim confidence, flow confidence, thresholds, rounding, penalties and aggregation.

This assessment lifecycle catalog owns rule IDs, rule order, rule inputs and rule outputs only. Implementations must not implement a second confidence formula from this document. For each rule, `confidenceImpact` is metadata used by the domain-spec calculator as supporting context, not an independent scoring algorithm.
<!-- PHASE-5-5-AIUSAGEFLOW-TECHNICALPROFILE:END -->
