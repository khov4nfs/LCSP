# LCSP — Interview Agent Canonical Technical Contract

**Contract version:** `interview-technical-contract-v1.0.0`  
**Status:** **FROZEN FOR IMPLEMENTATION**  
**Business source:** `LCSP — Interview Agent Business Architecture`, Section 16 frozen invariants and Section 17 technical-contract worklist.  
**Purpose:** Lock the runtime/model/orchestrator contracts required to implement Interview Agent without reopening the reasoning architecture.

---

## 1. Normative Status and Design Rule

This document is the canonical implementation contract for Interview Agent V1.

The following are **normative**:

- type names and field semantics in this document;
- allowed enum values;
- required/forbidden fields by discriminator;
- mode/outcome transition rules;
- authority and provenance rules;
- compatibility behavior for `PRE_PLANNER`;
- technical-coverage invocation boundary;
- Customer-safe evidence boundary;
- exact-resume / downstream-impact behavior;
- audit and optimistic-concurrency requirements.

The implementation may choose framework/library details, storage engine, LangGraph node names and internal helper names, but it must not weaken or reinterpret the normative rules.

### 1.1 One-source-of-truth schema rule

The codebase must have one canonical machine-validatable schema source for these contracts. TypeScript types, JSON Schema/OpenAPI and runtime validators must be generated from or verified against the same source of truth. Hand-maintained duplicate schemas are not allowed.

### 1.2 Boundary rule

```text
Interview Agent = business-context reasoning
Assessment Orchestration = runtime authority + state transitions
Persistence = factual history/revisions/audit
Validators = guardrails
UI = rendering and Customer input
```

Deterministic code must not become a second question-selection or sufficiency-reasoning engine.

---

## 2. Canonical Names, Versions and Primitive Types

```ts
type InterviewContractVersion = "interview-technical-contract-v1.0.0";

type InterviewMode =
  | "INITIAL_INTERVIEW"
  | "INVESTIGATOR_RESOLUTION";

type LegacyInterviewMode = "PRE_PLANNER";

type InterviewOutcome =
  | "WAITING_FOR_CUSTOMER"
  | "CONTEXT_READY"
  | "CONTEXT_RESOLVED"
  | "BLOCKED_OR_UNRESOLVED"
  | "FAILED";

type InterviewFlag = "DOWNSTREAM_IMPACT";

type TechnicalCoverageState = "READY" | "PARTIAL";

type BusinessContextSource =
  | "CUSTOMER_STATED"
  | "CUSTOMER_CONFIRMED";

type BusinessContextResolutionState =
  | "CONFIRMED"
  | "UNCERTAIN"
  | "CONFLICTED"
  | "SUPERSEDED";

type EvidenceSourceType =
  | "TECHNICAL_EVIDENCE"
  | "DOCUMENTARY_EVIDENCE";

type EvidenceResolutionState =
  | "OBSERVED"
  | "CORROBORATED"
  | "INFERRED"
  | "UNRESOLVED"
  | "STALE";

type QuestionIntent = "ASK" | "CLARIFY";

type QuestionResponseMode =
  | "FREE_TEXT"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "BOOLEAN"
  | "CONFIRM_ADJUST";
```

### 2.1 Compatibility normalization

`PRE_PLANNER` is accepted only at an external compatibility boundary.

```text
PRE_PLANNER
→ compatibility adapter
→ INITIAL_INTERVIEW
→ canonical runtime/model contract
```

Rules:

- Canonical `InterviewAgentInput.mode` never contains `PRE_PLANNER`.
- New persistence/events must store the canonical mode.
- New code must not branch on `PRE_PLANNER` outside the compatibility adapter.
- The adapter must be removable without changing business behavior.

---

## 3. JSON Value and Collection Helpers

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

type NonEmptyArray<T> = [T, ...T[]];
```

Where this contract says `NonEmptyArray<T>`, an empty array is a contract violation.

---

## 4. Subject System, Locale and Artifact Versions

```ts
type SubjectSystemIdentity = {
  systemRef: string;          // stable LCSP internal reference
  displayName: string;
  workspaceRef: string;
  projectRef?: string;
};

type ArtifactVersions = {
  sourceVersionRef: string;           // commit/source snapshot used by assessment
  scannerRunRef: string;
  programEvidenceGraphVersion: string;
};

type LocaleTag = string; // BCP-47, e.g. "vi-VN", "en-US"
```

Rules:

- `SubjectSystemIdentity`, assessment identity and artifact versions are runtime-authoritative.
- Prompt/scenario/customer text cannot override them.
- `locale` controls Customer-facing wording/labels only; it cannot change normalized choice values or business semantics.

---

## 5. Technical Coverage Contract

`UNAVAILABLE` is deliberately absent from model-visible `TechnicalCoverage`.

```ts
type CoverageLimitation = {
  code: string;
  summary: string;
  affectedScopeRefs?: string[];
};

type TechnicalCoverage =
  | {
      state: "READY";
      limitations: [];
      policyDecisionRef: string;
    }
  | {
      state: "PARTIAL";
      limitations: NonEmptyArray<CoverageLimitation>;
      policyDecisionRef: string;
    };
```

### 5.1 Orchestrator precondition

```text
Scanner/PGE coverage = UNAVAILABLE
→ do not invoke Interview Agent
→ recovery / retry / technical block
```

For `PARTIAL`, the Orchestrator/product coverage policy must already have decided that Interview invocation is permitted. Interview Agent receives the limitation but does not re-decide scanner readiness.

### 5.2 Absence-of-evidence invariant

No component may normalize:

```text
not found in PGE
→ business behavior does not exist
```

Technical absence can become a Customer question only if the remaining distinction is both customer-owned and material.

---

## 6. BusinessContextScope — Strongly Typed but Extensible

```ts
type ScopeExtension = {
  namespace: string;
  key: string;
  values: NonEmptyArray<string>;
};

type BusinessContextScope = {
  systemRefs: NonEmptyArray<string>;
  componentRefs?: string[];
  workflowRefs?: string[];
  actorGroupRefs?: string[];
  environmentRefs?: string[];
  operatingRegionRefs?: string[];
  extensions?: ScopeExtension[];
};
```

Rules:

- Every context statement is scoped to at least one assessed system.
- Optional fields are not required-fact slots and must not be treated as a questionnaire taxonomy.
- `extensions` provides typed extensibility without allowing arbitrary nested scope JSON.
- Scope must preserve Customer wording boundaries; team-scoped truth must not silently become organization-wide truth.

---

## 7. BusinessContextStatement — Persisted Canonical Record

```ts
type BusinessContextStatementBase = {
  statementId: string;                    // application-generated
  assessmentId: string;
  topic: string;                          // extensible semantic topic
  statement: string;                      // human-readable business meaning
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];                 // governed evidence refs, not proof of Customer confirmation
  respondentRef: string;                  // authenticated actor reference
  createdAt: string;                      // RFC3339 timestamp, application-generated
  supersedesStatementId?: string;
};

type CustomerStatedContextStatement =
  BusinessContextStatementBase & {
    source: "CUSTOMER_STATED";
    resolutionState:
      | "UNCERTAIN"
      | "CONFLICTED"
      | "SUPERSEDED";
  };

type CustomerConfirmedContextStatement =
  BusinessContextStatementBase & {
    source: "CUSTOMER_CONFIRMED";
    resolutionState:
      | "CONFIRMED"
      | "CONFLICTED"
      | "SUPERSEDED";
  };

type BusinessContextStatement =
  | CustomerStatedContextStatement
  | CustomerConfirmedContextStatement;

type ConfirmedBusinessContextStatement =
  CustomerConfirmedContextStatement & {
    resolutionState: "CONFIRMED";
  };
```

### 7.1 Authoritative downstream context

Only `ConfirmedBusinessContextStatement[]` may populate `currentConfirmedBusinessContext` and downstream Structured Assessment Context.

The following are rejected from that collection:

- `CUSTOMER_STATED`;
- `UNCERTAIN`;
- `CONFLICTED`;
- `SUPERSEDED`.

### 7.2 Source and resolution are separate dimensions

- `CUSTOMER_STATED` answers **where the information came from / how established it is**.
- `UNCERTAIN` answers **whether the business reality is resolved**.
- `CUSTOMER_CONFIRMED + CONFIRMED` is the only authoritative combination.
- Two explicitly confirmed statements from different respondents may both retain `source = CUSTOMER_CONFIRMED` while the current topic resolution becomes `CONFLICTED`.

### 7.3 Actor provenance rule

`respondentRef` is bound from authenticated runtime context. The model and Customer payload are not trusted to choose or rewrite it.

---

## 8. BusinessContextUpdate — Agent Proposal Before Persistence

The model must not manufacture authoritative IDs, timestamps or authenticated actor identity.

```ts
type BusinessContextUpdateBase = {
  topic: string;
  statement: string;
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];
  supersedesStatementId?: string;
};

type CustomerStatedContextUpdate = BusinessContextUpdateBase & {
  source: "CUSTOMER_STATED";
  resolutionState:
    | "UNCERTAIN"
    | "CONFLICTED"
    | "SUPERSEDED";
};

type CustomerConfirmedContextUpdate = BusinessContextUpdateBase & {
  source: "CUSTOMER_CONFIRMED";
  resolutionState:
    | "CONFIRMED"
    | "CONFLICTED"
    | "SUPERSEDED";
};

type BusinessContextUpdate =
  | CustomerStatedContextUpdate
  | CustomerConfirmedContextUpdate;
```

Runtime validation rules:

- Allowed source/resolution pairs are exactly the pairs encoded by the discriminated union above.
- `CUSTOMER_STATED + CONFIRMED` is invalid.
- `CUSTOMER_CONFIRMED + UNCERTAIN` is invalid.
- A current-turn update requires an authenticated `respondentRef` in runtime context before persistence.
- Application assigns `statementId`, `assessmentId`, `respondentRef`, `createdAt` and revision metadata.
- Explicit correction/supersession must reference the prior statement when known; “later answer wins” is forbidden.

---

## 9. Governed Evidence and Customer-Safe Evidence DTOs

```ts
type GovernedEvidenceItem = {
  evidenceRef: string;
  sourceType: EvidenceSourceType;
  resolutionState: EvidenceResolutionState;
  observation: string;                    // authorized model-visible observation
  sourceVersionRef: string;
  scope: BusinessContextScope;
  customerSafeSummary?: string;            // separately approved/sanitized disclosure
};

type SafeEvidenceContext = {
  items: GovernedEvidenceItem[];
};
```

Rules:

- `observation` may be richer than the Customer-visible explanation but is still bounded and authorized for Interview runtime.
- `customerSafeSummary` is the only default evidence text rendered in Interview UI.
- A question may reference only evidence refs available to the current assessment/tenant.
- If a referenced item has no `customerSafeSummary`, the UI must not fall back to `observation` or raw source.
- `STALE` evidence may remain visible as history but cannot be silently treated as current factual support.

---

## 10. ChoiceOption — Stable Value / Localized Label

```ts
type ChoiceOption = {
  value: string;   // stable normalized value used in persistence/analytics
  label: string;   // localized Customer-facing label
};
```

Rules:

- Backend logic uses `value`, never `label`.
- Labels may change with locale or wording updates without changing stored meaning.
- Choice values must be unique inside one question.
- A submitted choice value must exist in the persisted question version being answered.

---

## 11. InterviewQuestion — Canonical Interaction Contract

### 11.1 Proposed interpretation

```ts
type ProposedInterpretation = {
  topic: string;
  statement: string;
  normalizedValue?: JsonValue;
  scope: BusinessContextScope;
  evidenceRefs: string[];
};
```

A proposed interpretation is **not confirmed context** until the Customer confirms it.

### 11.2 Question draft returned by Interview reasoning

```ts
type QuestionBase = {
  intent: QuestionIntent;
  text: string;
  reasonSummary: string;
  evidenceRefs: string[]; // refs eligible for Customer-safe rendering
};

type FreeTextQuestion = QuestionBase & {
  responseMode: "FREE_TEXT";
};

type SingleSelectQuestion = QuestionBase & {
  responseMode: "SINGLE_SELECT";
  choices: NonEmptyArray<ChoiceOption>;
};

type MultiSelectQuestion = QuestionBase & {
  responseMode: "MULTI_SELECT";
  choices: NonEmptyArray<ChoiceOption>;
};

type BooleanQuestion = QuestionBase & {
  responseMode: "BOOLEAN";
};

type ConfirmAdjustQuestion = QuestionBase & {
  intent: "CLARIFY";
  responseMode: "CONFIRM_ADJUST";
  proposedInterpretation: NonEmptyArray<ProposedInterpretation>;
  choices: [
    { value: "CONFIRM"; label: string },
    { value: "ADJUST"; label: string }
  ];
};

type InterviewQuestionDraft =
  | FreeTextQuestion
  | SingleSelectQuestion
  | MultiSelectQuestion
  | BooleanQuestion
  | ConfirmAdjustQuestion;
```

### 11.3 Persisted question

```ts
type InterviewQuestion = InterviewQuestionDraft & {
  questionRef: string;       // application-generated
  sessionId: string;
  sequence: number;
  createdAt: string;
};
```

### 11.4 Confirm/Adjust semantic rule

`CONFIRM` is not a third question intent.

```text
reasoning intent = CLARIFY
interaction mode = CONFIRM_ADJUST
```

Use Confirm/Adjust only for a material/non-trivial interpretation that needs explicit Customer confirmation.

Do not generate Confirm/Adjust for:

- direct explicit semantically lossless Customer statements;
- pure formatting/presentation normalization.

---

## 12. CustomerAnswer — Canonical Payload

```ts
type CustomerAnswer =
  | {
      kind: "FREE_TEXT";
      text: string;
    }
  | {
      kind: "SINGLE_SELECT";
      value: string;
      comment?: string;
    }
  | {
      kind: "MULTI_SELECT";
      values: NonEmptyArray<string>;
      comment?: string;
    }
  | {
      kind: "BOOLEAN";
      value: boolean;
      comment?: string;
    }
  | {
      kind: "CONFIRM_ADJUST";
      action: "CONFIRM";
      comment?: string;
    }
  | {
      kind: "CONFIRM_ADJUST";
      action: "ADJUST";
      adjustmentText: string;
    };
```

Validation rules:

- Answer `kind` must match the persisted question `responseMode`.
- `ADJUST` requires non-empty `adjustmentText`.
- Selected values must exist in the persisted question choices.
- Multi-select values must be unique.
- UI labels are never accepted as normalized choice identity.
- CustomerAnswer does not contain `respondentRef`; authentication middleware/runtime supplies actor identity.

### 12.1 Submit command

```ts
type SubmitInterviewAnswerCommand = {
  contractVersion: InterviewContractVersion;
  assessmentId: string;
  sessionId: string;
  questionRef: string;
  expectedSessionRevision: number;
  clientRequestId: string; // idempotency key
  answer: CustomerAnswer;
};
```

The runtime rejects stale `expectedSessionRevision`, reused `clientRequestId` with different payload, or answers to a non-current question.

---

## 13. InvestigatorNeed — Bounded Targeted Clarification Handoff

```ts
type InvestigatorNeed = {
  businessContextNeed: string;
  resolutionCriteria: string;
  whyNeeded?: string;
  relatedEvidenceRefs?: string[];
  originatingInvestigationReference: string;
};
```

Rules:

- Required only in `INVESTIGATOR_RESOLUTION`.
- Forbidden in `INITIAL_INTERVIEW`.
- `resolutionCriteria` is business-operational and neutral.
- It must not expose EngineeringRule/legal intent or prescribe the Customer answer.
- `originatingInvestigationReference` is an opaque safe reference, not a continuation token.
- Continuation/checkpoint remains exclusively in Orchestrator state and is never returned by Interview Agent.

---

## 14. Interview History and Current Customer Turn

```ts
type InterviewTurnSnapshot = {
  turnRef: string;
  sequence: number;
  question: InterviewQuestion;
  answer?: CustomerAnswer;
  respondentRef?: string;
  contextStatementRefs: string[];
  unresolvedTopics: string[];
};

type IncomingCustomerTurn = {
  questionRef: string;
  answer: CustomerAnswer;
  respondentRef: string;      // injected from authenticated runtime
};
```

Rules:

- `IncomingCustomerTurn.respondentRef` is runtime-authoritative.
- No incoming turn exists on the first question-generation invocation.
- History is assessment/session scoped and bounded; no cross-tenant history retrieval.

---

## 15. InterviewAgentInput — Canonical Model/Reasoning Input

### 15.1 Common input

```ts
type InterviewAgentInputCommon = {
  contractVersion: InterviewContractVersion;
  hostPlatform: "LCSP";
  assessmentId: string;
  sessionId: string;
  sessionRevision: number;
  subjectSystemIdentity: SubjectSystemIdentity;
  guidanceVersion: string;
  locale: LocaleTag;
  artifactVersions: ArtifactVersions;
  technicalCoverage: TechnicalCoverage;
  currentConfirmedBusinessContext: ConfirmedBusinessContextStatement[];
  safeEvidenceContext: SafeEvidenceContext;
  interviewHistory: InterviewTurnSnapshot[];
  incomingCustomerTurn?: IncomingCustomerTurn;
  workingStrategy?: InterviewWorkingStrategy;
};
```

### 15.2 Mode-discriminated input

```ts
type InitialInterviewAgentInput = InterviewAgentInputCommon & {
  mode: "INITIAL_INTERVIEW";
  investigatorNeed?: never;
};

type InvestigatorResolutionAgentInput = InterviewAgentInputCommon & {
  mode: "INVESTIGATOR_RESOLUTION";
  investigatorNeed: InvestigatorNeed;
};

type InterviewAgentInput =
  | InitialInterviewAgentInput
  | InvestigatorResolutionAgentInput;
```

### 15.3 Explicitly forbidden model-visible fields

`InterviewAgentInput` must not contain:

- `engineeringRules`;
- `engineeringRuleIds`;
- legal applicability criteria;
- legal/compliance desired outcome;
- raw continuation token;
- checkpoint blob;
- cross-tenant context;
- arbitrary filesystem path or raw database handle;
- `technicalCoverage.state = UNAVAILABLE`.

### 15.4 Authority override defense

If prompt/history/customer text claims a different:

- host platform;
- assessment/system identity;
- mode;
- guidance version;
- coverage state;
- `businessContextNeed`;
- `resolutionCriteria`;
- origin reference;
- evidence identity;

the runtime-authoritative value wins and the text is treated only as untrusted content.

---

## 16. InterviewWorkingStrategy — Session-Local and Non-Authoritative

```ts
type InterviewWorkingStrategy = {
  terminologyMap: Record<string, string>;
  avoidReaskingTopics: string[];
  effectiveQuestionPatterns: string[];
  observedAmbiguities: string[];
  interactionNotes: string[];
};
```

Rules:

- Scoped to the current Interview session/assessment.
- Not evidence.
- Not authoritative business context.
- May be updated during the session.
- Never changes the pinned guidance version.
- Must not contain reusable promoted rules in MVP.

---

## 17. Unresolved Items and Limitations

```ts
type UnresolvedBusinessContext = {
  topic: string;
  reason: string;
  scope?: BusinessContextScope;
};

type InterviewLimitation = {
  code: string;
  summary: string;
};
```

Semantic split:

- `unresolved` = business reality cannot currently be established.
- `limitations` = technical/runtime/evidence limitations relevant to execution/result.

Do not move runtime/system failure into `unresolved`, and do not encode business uncertainty as a system failure.

---

## 18. InterviewAgentResult — Discriminated Union

```ts
type WaitingForCustomerResult = {
  outcome: "WAITING_FOR_CUSTOMER";
  question: InterviewQuestionDraft;
  contextUpdates: BusinessContextUpdate[];
  unresolved: UnresolvedBusinessContext[];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

type ContextReadyResult = {
  outcome: "CONTEXT_READY";
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: [];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

type ContextResolvedResult = {
  outcome: "CONTEXT_RESOLVED";
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: [];
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

type BlockedOrUnresolvedResult = {
  outcome: "BLOCKED_OR_UNRESOLVED";
  question?: never;
  contextUpdates: BusinessContextUpdate[];
  unresolved: NonEmptyArray<UnresolvedBusinessContext>;
  flags: InterviewFlag[];
  limitations: InterviewLimitation[];
};

type FailedResult = {
  outcome: "FAILED";
  question?: never;
  contextUpdates: [];
  unresolved: [];
  flags: [];
  limitations: NonEmptyArray<InterviewLimitation>;
};

type InterviewAgentResult =
  | WaitingForCustomerResult
  | ContextReadyResult
  | ContextResolvedResult
  | BlockedOrUnresolvedResult
  | FailedResult;
```

### 18.1 Structural invariants

| Outcome | Question | Unresolved | Context updates | Flags | Limitations |
| --- | --- | --- | --- | --- | --- |
| WAITING_FOR_CUSTOMER | required | 0..n | allowed | allowed | allowed |
| CONTEXT_READY | forbidden | exactly `[]` | allowed | allowed | allowed |
| CONTEXT_RESOLVED | forbidden | exactly `[]` | allowed | allowed | allowed |
| BLOCKED_OR_UNRESOLVED | forbidden | non-empty | allowed | allowed | allowed |
| FAILED | forbidden | exactly `[]` | exactly `[]` | exactly `[]` | non-empty |

### 18.2 Mode/outcome invariants

`INITIAL_INTERVIEW` allows:

- `WAITING_FOR_CUSTOMER`
- `CONTEXT_READY`
- `BLOCKED_OR_UNRESOLVED`
- `FAILED`

`CONTEXT_RESOLVED` is invalid.

`INVESTIGATOR_RESOLUTION` allows:

- `WAITING_FOR_CUSTOMER`
- `CONTEXT_RESOLVED`
- `BLOCKED_OR_UNRESOLVED`
- `FAILED`

`CONTEXT_READY` is invalid.

### 18.3 Flag invariant

`DOWNSTREAM_IMPACT` never becomes an outcome and never instructs Interview Agent to choose rerun granularity.

---

## 19. InterviewRuntimeResult — Authoritative Runtime Envelope

`InterviewAgentResult` contains reasoning output only. Runtime-authoritative metadata is added outside it.

```ts
type InterviewRuntimeResult = {
  contractVersion: InterviewContractVersion;
  assessmentId: string;
  sessionId: string;
  invocationRef: string;
  mode: InterviewMode;
  guidanceVersion: string;
  modelId?: string;
  artifactVersions: ArtifactVersions;
  contextRevisionBefore: string;
  contextRevisionAfter?: string;
  sessionRevisionBefore: number;
  sessionRevisionAfter: number;
  persistedQuestionRef?: string;
  generatedAt: string;
  agentResult: InterviewAgentResult;
};
```

Rules:

- Envelope fields are set by runtime/application, not copied blindly from model output.
- `contextRevisionAfter` is present only when context persistence created a new revision.
- `persistedQuestionRef` is required when `agentResult.outcome = WAITING_FOR_CUSTOMER` and forbidden otherwise.
- `sessionRevisionAfter` must be greater than `sessionRevisionBefore` after a successful persisted transition.
- `mode` is canonical; `PRE_PLANNER` never appears here.
- Runtime may reject the agent result and emit a contract/runtime error instead of creating an invalid envelope.

---

## 20. Context Revision and Optimistic Concurrency Contract

The current confirmed context is revisioned.

```ts
type ContextRevision = {
  contextRevisionRef: string;
  assessmentId: string;
  parentRevisionRef?: string;
  confirmedStatementRefs: string[];
  createdAt: string;
  createdByActorRef: string;
};
```

Rules:

- No silent overwrite.
- Context writes use compare-and-swap / optimistic concurrency against the expected current revision.
- A stale answer or stale Interview invocation must not overwrite a newer context revision.
- New confirmed context revision is created only after validated updates are persisted.
- `DOWNSTREAM_IMPACT` may be emitted when a new confirmed revision materially changes previously relied-on context; Orchestrator determines the affected downstream state.

---

## 21. Interview Session and Turn Persistence

```ts
type InterviewSession = {
  sessionId: string;
  assessmentId: string;
  mode: InterviewMode;
  status:
    | "ACTIVE"
    | "WAITING_FOR_CUSTOMER"
    | "READY"
    | "RESOLVED"
    | "BLOCKED_OR_UNRESOLVED"
    | "FAILED"
    | "CLOSED";
  guidanceVersion: string;
  locale: LocaleTag;
  sessionRevision: number;
  createdAt: string;
  updatedAt: string;
};
```

Persistence must retain enough history to reconstruct:

- question shown;
- Customer answer and authenticated respondent;
- interpretation/context updates;
- confirmation/adjustment action;
- unresolved items;
- context revisions;
- evidence refs;
- guidance version;
- model/runtime metadata required for audit;
- outcome and Workflow Run event.

---

## 22. Audit Provenance Contract

```ts
type InterviewAuditRecord = {
  auditRef: string;
  assessmentId: string;
  sessionId: string;
  action:
    | "QUESTION_PERSISTED"
    | "CUSTOMER_ANSWER_RECORDED"
    | "CONTEXT_STATEMENT_CREATED"
    | "CONTEXT_STATEMENT_SUPERSEDED"
    | "CONTEXT_REVISION_CREATED"
    | "INTERVIEW_OUTCOME_RECORDED"
    | "DOWNSTREAM_IMPACT_FLAGGED";
  actorRef: string;              // Customer or system actor as appropriate
  timestamp: string;
  sourceVersionRef: string;
  pgeVersion: string;
  guidanceVersion: string;
  contextRevisionBefore?: string;
  contextRevisionAfter?: string;
  questionRef?: string;
  statementRefs?: string[];
  evidenceRefs?: string[];
};
```

Rules:

- Material Customer statement/confirmation/correction/supersession must resolve to authenticated actor provenance.
- Actor identity is never accepted from prompt text as authentication.
- Audit is append-only from the product perspective; corrections create new records/revisions.

---

## 23. Workflow Run Events — Canonical Names

The Interview implementation maps to the existing Workflow Run surface; it does not expose internal mode as a separate Customer badge.

```ts
type InterviewWorkflowEvent =
  | "INTERVIEW_STARTED"
  | "INTERVIEW_WAITING_FOR_CUSTOMER"
  | "INTERVIEW_CONTEXT_UPDATED"
  | "INTERVIEW_CONTEXT_READY"
  | "INTERVIEW_CONTEXT_RESOLVED"
  | "INTERVIEW_BLOCKED_OR_UNRESOLVED"
  | "INTERVIEW_FAILED"
  | "DOWNSTREAM_REEVALUATION_STARTED"
  | "INVESTIGATION_RESUMED";
```

UI rules:

- `WAITING_FOR_CUSTOMER` renders the current question and saved answer history.
- `BLOCKED_OR_UNRESOLVED` renders the unresolved distinction plus MVP actions: **Provide more context / I need to check internally / Save & Exit**.
- No separate “Investigator clarification mode” badge is required.
- Evidence explanations shown in UI must come from Customer-safe summaries.

---

## 24. Orchestrator Transition Contract

### 24.1 Transition function boundary

Conceptually:

```ts
type OrchestratorInterviewTransitionInput = {
  runtimeResult: InterviewRuntimeResult;
  currentAssessmentStateRef: string;
  currentContextRevision: string;
};

type OrchestratorInterviewAction =
  | "WAIT_FOR_CUSTOMER"
  | "CONTINUE_TO_ENGINEERING_RULE"
  | "KEEP_BUSINESS_CONTEXT_BLOCKED"
  | "ROUTE_RUNTIME_RECOVERY"
  | "RESUME_EXACT_INVESTIGATOR"
  | "SELECTIVE_RERUN_RESCOPE";
```

The Orchestrator transition logic must be deterministic over validated state; it must not re-reason which business question should have been asked.

### 24.2 Canonical matrix

| Mode | Outcome / Flag | Orchestrator action | Required checks |
| --- | --- | --- | --- |
| INITIAL_INTERVIEW | WAITING_FOR_CUSTOMER | WAIT_FOR_CUSTOMER | persist/materialize question, checkpoint session |
| INITIAL_INTERVIEW | CONTEXT_READY | CONTINUE_TO_ENGINEERING_RULE | persist validated context updates; freeze current confirmed revision |
| INITIAL_INTERVIEW | BLOCKED_OR_UNRESOLVED | KEEP_BUSINESS_CONTEXT_BLOCKED | unresolved non-empty; persist limitation/state |
| INITIAL_INTERVIEW | FAILED | ROUTE_RUNTIME_RECOVERY | do not classify as Customer uncertainty |
| INVESTIGATOR_RESOLUTION | WAITING_FOR_CUSTOMER | WAIT_FOR_CUSTOMER | keep originating investigation suspended |
| INVESTIGATOR_RESOLUTION | CONTEXT_RESOLVED, no impact flag | RESUME_EXACT_INVESTIGATOR | validate origin, continuation, source/PGE/context freshness |
| INVESTIGATOR_RESOLUTION | CONTEXT_RESOLVED + DOWNSTREAM_IMPACT | SELECTIVE_RERUN_RESCOPE | never blindly exact-resume |
| INVESTIGATOR_RESOLUTION | BLOCKED_OR_UNRESOLVED | KEEP_BUSINESS_CONTEXT_BLOCKED | keep originating investigation blocked |
| INVESTIGATOR_RESOLUTION | FAILED | ROUTE_RUNTIME_RECOVERY | runtime/system recovery |

### 24.3 Exact-resume validation

Before `RESUME_EXACT_INVESTIGATOR`, Orchestrator must verify all of the following:

1. `originatingInvestigationReference` still maps to the expected suspended investigation.
2. The opaque continuation/checkpoint still exists in Orchestrator-owned state.
3. The continuation has not already been consumed.
4. The assessment/source/PGE versions required by that investigation have not become incompatible.
5. The current confirmed context revision is compatible with the suspended investigation.
6. The targeted `businessContextNeed` has not been superseded/cancelled by another orchestration change.
7. `DOWNSTREAM_IMPACT` is absent.

If any check fails, exact resume is forbidden. Orchestrator must recompute/selective-rerun/rescope according to dependency/provenance/staleness rules.

### 24.4 Downstream impact contract

Interview Agent may only emit:

```text
flags += DOWNSTREAM_IMPACT
```

It must not emit affected rule IDs, node IDs or rerun scope as authoritative instructions.

Orchestrator computes:

```text
confirmed context revision change
→ dependency/provenance/staleness analysis
→ selective invalidation
→ selective rerun/rescope
→ Workflow Run update
```

---

## 25. BLOCKED_OR_UNRESOLVED Contract

`BLOCKED_OR_UNRESOLVED` is valid only when the business ambiguity cannot currently be established reliably.

Semantic stop:

```text
Customer explicitly cannot currently provide more information
+
current governed evidence cannot resolve the material ambiguity
→ BLOCKED_OR_UNRESOLVED
```

Rules:

- No retry-count threshold may auto-complete the context.
- It is not equivalent to `FAILED`.
- It is not necessarily permanent; new Customer information or new governed evidence may reopen Interview.
- `unresolved` must describe the exact business distinction that remains unknown.

---

## 26. Runtime Validation Rules — P0

The following validations are mandatory before coding is considered complete.

### 26.1 Input validation

Reject or prevent invocation when:

- `mode` is not canonical after compatibility normalization;
- `technicalCoverage = UNAVAILABLE`;
- Initial mode contains `investigatorNeed`;
- Investigator Resolution omits `investigatorNeed`;
- `currentConfirmedBusinessContext` contains non-confirmed/non-authoritative items;
- assessment/system/artifact identity is missing;
- referenced evidence is outside assessment/tenant authorization;
- incoming Customer answer has no authenticated runtime respondent;
- incoming answer does not match the persisted current question/session revision.

### 26.2 Result validation

Reject result when:

- mode/outcome combination is invalid;
- `WAITING_FOR_CUSTOMER` has no question;
- READY/RESOLVED/BLOCKED/FAILED includes a question;
- READY/RESOLVED has non-empty `unresolved`;
- BLOCKED has empty `unresolved`;
- FAILED contains context updates, unresolved items or flags;
- FAILED has no limitation;
- `CUSTOMER_STATED + CONFIRMED` context update appears;
- Confirm/Adjust question has intent other than `CLARIFY`;
- Confirm/Adjust choices are not stable values `CONFIRM` / `ADJUST`;
- question evidence refs are not eligible for Customer-safe disclosure;
- a context update attempts to set actor identity/timestamp/assessment ID as model authority.

### 26.3 Prompt override validation

Test and guard against Customer/repository/prompt attempts to rewrite:

- `assessmentId`;
- subject-system identity;
- mode;
- guidance version;
- coverage state;
- targeted need;
- resolution criteria;
- origin reference;
- governed evidence refs.

The runtime contract wins.

---

## 27. Error Taxonomy

```ts
type InterviewContractErrorCode =
  | "INVALID_INPUT"
  | "INVALID_RESULT"
  | "INVALID_MODE_OUTCOME"
  | "STALE_SESSION_REVISION"
  | "STALE_CONTEXT_REVISION"
  | "STALE_ORIGIN"
  | "CONTINUATION_INVALID"
  | "EVIDENCE_REF_INVALID"
  | "EVIDENCE_DISCLOSURE_FORBIDDEN"
  | "RESPONDENT_REQUIRED"
  | "ANSWER_QUESTION_MISMATCH"
  | "COVERAGE_NOT_INVOCABLE"
  | "AUTHORITY_OVERRIDE_ATTEMPT"
  | "RUNTIME_TOOL_FAILURE";
```

Errors are runtime/system concerns and must not be converted into Customer business uncertainty.

---

## 28. Tool and Service Boundary

Minimum Interview-facing capability categories:

- read current confirmed business context;
- read bounded authorized evidence context;
- bounded search over PGE/evidence;
- read Interview history;
- persist Interview turn/question/answer;
- persist validated context updates through application service;
- record audit/learning proposal.

Explicitly denied to Interview reasoning:

- shell/execute;
- unrestricted repository filesystem;
- raw database access;
- source/PGE mutation;
- LegalRule/EngineeringRule mutation;
- compliance verdict write authority;
- tool-permission management;
- cross-tenant retrieval;
- raw continuation/checkpoint manipulation.

The concrete service names are implementation details; these authority limits are contractual.

---

## 29. API Boundary — Minimum Required Endpoints/Commands

Exact HTTP/RPC naming is implementation-specific, but behavior must support:

1. **Start/Resume Interview** for an Assessment.
2. **Get Current Interview State** for Workflow Run/UI.
3. **Submit Customer Answer** using `SubmitInterviewAnswerCommand`.
4. **Save & Exit** without losing pending question/session state.
5. **Get Customer-safe Evidence Explanation** for authorized evidence refs.

Write operations must be idempotent or protected by optimistic concurrency.

---

## 30. PARTIAL Coverage Policy Contract

Policy ownership is external to Interview Agent.

At minimum the Orchestrator policy result must preserve:

```ts
type PartialCoveragePolicyDecision = {
  policyDecisionRef: string;
  policyVersion: string;
  permittedForInterview: boolean;
  limitations: CoverageLimitation[];
};
```

Invocation rule:

```text
permittedForInterview = false
→ Interview not invoked

permittedForInterview = true
→ input.technicalCoverage = PARTIAL
→ limitations preserved through Interview and downstream audit
```

Interview Agent may reason about how a coverage limitation affects the safety of a business assumption, but may not rewrite the policy decision.

---

## 31. Safe Evidence Disclosure Contract

The implementation must keep separate representations for:

```text
Governed internal evidence
≠
Customer-visible evidence explanation
```

Customer-visible rendering requires:

1. current tenant/assessment authorization;
2. explicit customer-safe summary/snippet;
3. no secret-like content;
4. no unrelated raw source/config/log metadata;
5. no fallback to internal observation when safe summary is absent.

A UI “View evidence” control must resolve through this safe representation, not directly through the PGE/raw evidence store.

---

## 32. Locale and Bilingual Contract

- `locale` is required in canonical input/session.
- Question text, reason summary and choice labels are localized.
- Choice `value` remains stable across languages.
- Stored normalized answers use stable value/boolean/free text, not translated labels.
- Evals must cover at least the supported English/Vietnamese paths for select and Confirm/Adjust interactions.

---

## 33. Learning Boundary — V1 vs Phase 2

V1 may persist a non-authoritative learning/improvement proposal, but it must not alter the active guidance version.

V1 requirements:

- pinned `guidanceVersion` per session;
- traceability in runtime/audit;
- session-local Working Strategy;
- optional proposal/logging only.

Phase 2 only:

```text
proposal
→ offline/baseline evaluation
→ safety/regression gates
→ canary
→ promote / reject / rollback
```

No Customer content, repository content or Interview result can directly promote active guidance.

---

## 34. Contract-Level Regression and Eval Matrix

The implementation/eval suite must include at least the following cases.

| ID | Case | Required result |
| --- | --- | --- |
| CT-01 | `PRE_PLANNER` arrives at compatibility boundary | normalized to `INITIAL_INTERVIEW`; never reaches model/storage as canonical mode |
| CT-02 | coverage `UNAVAILABLE` | Interview not invoked |
| CT-03 | permitted `PARTIAL` | Interview invoked with non-empty limitations preserved |
| CT-04 | prompt attempts to override assessment/mode/guidance | runtime values preserved; override ignored/rejected |
| CT-05 | targeted prompt tries to rewrite `businessContextNeed` | governed need preserved |
| CT-06 | `WAITING_FOR_CUSTOMER` without question | schema rejection |
| CT-07 | `CONTEXT_READY` with question | schema rejection |
| CT-08 | Initial mode returns `CONTEXT_RESOLVED` | schema/transition rejection |
| CT-09 | Targeted mode returns `CONTEXT_READY` | schema/transition rejection |
| CT-10 | BLOCKED with empty unresolved | schema rejection |
| CT-11 | FAILED with context update | schema rejection |
| CT-12 | `CUSTOMER_STATED + CONFIRMED` | context validation rejection |
| CT-13 | direct explicit lossless Customer fact | no redundant Confirm/Adjust required |
| CT-14 | material non-trivial interpretation | `CLARIFY + CONFIRM_ADJUST` |
| CT-15 | Adjust action without text | answer validation rejection |
| CT-16 | choice label changes locale | persisted stable value unchanged |
| CT-17 | different respondents conflict | preserve provenance; do not later-wins overwrite |
| CT-18 | missing technical evidence | do not infer business absence |
| CT-19 | raw evidence lacks safe summary | UI must not expose raw/internal observation |
| CT-20 | targeted RESOLVED, origin still valid | exact Investigator resume |
| CT-21 | targeted RESOLVED + `DOWNSTREAM_IMPACT` | selective rerun/rescope before resume |
| CT-22 | targeted RESOLVED with stale continuation/origin | exact resume forbidden |
| CT-23 | Customer cannot currently establish fact and evidence cannot resolve | `BLOCKED_OR_UNRESOLVED` |
| CT-24 | runtime/tool failure | `FAILED`/runtime recovery, not BLOCKED |
| CT-25 | stale session revision answer submission | reject; no overwrite |
| CT-26 | replay same idempotency key with same payload | safe idempotent result |
| CT-27 | replay idempotency key with different payload | reject conflict |
| CT-28 | Vietnamese/English select question | same stable values, localized labels |
| CT-29 | Vietnamese/English Confirm/Adjust | same actions `CONFIRM`/`ADJUST`, localized labels |
| CT-30 | active guidance promotion attempted by Interview | denied; proposal only |

---

## 35. Implementation Order — Contract First

Coding should proceed in this order:

1. Implement canonical schemas/types and compatibility normalizer.
2. Implement runtime validators and negative tests.
3. Implement session/context revision persistence and audit provenance.
4. Implement Orchestrator transition matrix + exact-resume/staleness checks.
5. Implement bounded Interview retrieval/write service boundary.
6. Implement Interview reasoning runtime/skill against `InterviewAgentInput` and `InterviewAgentResult` only.
7. Implement Dynamic Question UI for `ASK`, `CLARIFY`, and `CONFIRM_ADJUST` response mode.
8. Implement Workflow Run event mapping and blocked/resume UI.
9. Implement end-to-end vertical slices and the regression matrix.
10. Only after the above, optimize prompting/model selection/UI polish.

---

## 36. Definition of Done Before Feature Coding Expands

The foundational contract implementation is complete only when all are true:

- [ ] `interview-technical-contract-v1.0.0` is represented by one machine-validatable schema source.
- [ ] `PRE_PLANNER` exists only in compatibility code/tests.
- [ ] `InterviewAgentInput` is mode-discriminated and cannot contain EngineeringRule/continuation fields.
- [ ] `currentConfirmedBusinessContext` is compile/runtime constrained to authoritative confirmed context.
- [ ] `InterviewQuestion` supports stable choices and `CLARIFY + CONFIRM_ADJUST`.
- [ ] `CustomerAnswer` is typed and validated against persisted question mode/values.
- [ ] `InterviewAgentResult` is a discriminated union with mode/outcome cross-validation.
- [ ] `InterviewRuntimeResult` supplies authoritative runtime metadata outside model reasoning output.
- [ ] `UNAVAILABLE` is blocked before Interview invocation.
- [ ] `PARTIAL` policy decision is Orchestrator-owned and auditable.
- [ ] context/session optimistic concurrency prevents stale overwrite.
- [ ] authenticated respondent provenance is persisted for material Customer statements/confirmations.
- [ ] safe-evidence representation is separated from internal evidence.
- [ ] exact Investigator resume validates origin/continuation/freshness.
- [ ] `DOWNSTREAM_IMPACT` routes to selective rerun/rescope rather than model-chosen rerun scope.
- [ ] Workflow Run maps all Interview states without a separate internal-mode badge.
- [ ] V1 learning cannot promote active guidance.
- [ ] CT-01 through CT-30 have automated coverage or an explicitly approved equivalent.

---

## 37. Change Control

### 37.1 Requires Product/BA review and contract major version

Any change to:

- canonical modes/outcomes;
- Interview vs Orchestrator authority;
- EngineeringRule exclusion from Interview reasoning;
- context authority semantics;
- Confirm/Adjust semantics;
- technical coverage ownership;
- targeted `resolutionCriteria` requirement;
- continuation ownership;
- `DOWNSTREAM_IMPACT` ownership;
- BLOCKED vs FAILED semantics;
- Protected Sufficiency boundary.

### 37.2 Technical minor/additive change

Backward-compatible additions such as optional audit metadata, new safe limitation codes, or additional non-breaking Workflow Run metadata may use a minor contract revision if they do not change business meaning.

### 37.3 Implementation-only change

Refactors to storage, framework, LangGraph node layout, internal class/function names or model provider do not require contract revision when wire semantics and frozen invariants remain unchanged.

---

## 38. Final Freeze Review

| Contract area | Decision | Status |
| --- | --- | --- |
| `InterviewRuntimeResult` | authoritative runtime envelope defined | FROZEN |
| `InterviewAgentInput` | canonical 2-mode discriminated input; legacy alias outside | FROZEN |
| `InterviewAgentResult` | outcome-discriminated union + mode cross-validation | FROZEN |
| `BusinessContextStatement` | source/resolution separated; confirmed subtype locked | FROZEN |
| `BusinessContextScope` | typed standard scope + extensible namespace entries | FROZEN |
| `InterviewQuestion` | `ASK/CLARIFY`; Confirm/Adjust as response mode | FROZEN |
| `CustomerAnswer` | typed union + stable choice values + idempotent submit envelope | FROZEN |
| Technical coverage | READY/PARTIAL model-visible; UNAVAILABLE pre-gated | FROZEN |
| Targeted clarification | need/criteria/origin ref locked; continuation excluded | FROZEN |
| Context revisions | optimistic concurrency + no silent overwrite | FROZEN |
| Audit provenance | authenticated actor + version/revision traceability | FROZEN |
| Safe evidence | internal vs Customer-visible DTO separation | FROZEN |
| Workflow Run | canonical events and UI mapping defined | FROZEN |
| Orchestrator transitions | exact deterministic matrix + stale-origin checks | FROZEN |
| Regression/evals | CT-01..CT-30 minimum matrix defined | FROZEN |

### Final verdict

**GO FOR IMPLEMENTATION.**

The Canonical Technical Contract 1.0.0 is frozen and is the authoritative implementation baseline. Implementation may vary internally, but must not change the frozen contract semantics without formal change control.
