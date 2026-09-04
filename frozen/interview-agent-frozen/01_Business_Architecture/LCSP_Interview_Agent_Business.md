# LCSP — Interview Agent Business Architecture

**Document type:** Canonical Business Architecture  
**Status:** **FROZEN**  
**Scope:** Interview Agent business behavior, authority boundary, orchestration handoff, customer interaction, context lifecycle, sufficiency, audit provenance and downstream impact.  
**Not in this document:** API/DTO/database/event/class names, LangGraph node implementation, persistence schema and concrete validator implementation.

---

## 1. Freeze Decision

Interview Agent business architecture is frozen at the reasoning/product level.

No further redesign of the reasoning architecture is required before Technical Design unless a new product decision changes one of the frozen invariants in Section 16.

The next phase is to define the **Canonical Technical Contract** that implements this architecture without changing its business meaning.

---

## 2. Canonical End-to-End Flow

```text
Minimal Project Setup
→ Repository / Source Configuration
→ Scanner
→ Program Evidence Graph (PGE)
→ Technical Coverage decision by Assessment Orchestration
   ├─ UNAVAILABLE → technical recovery / retry; do not invoke Interview
   └─ READY or permitted PARTIAL
      → Initial Interview
      → CONTEXT_READY
      → EngineeringRule stage
      → Planner
      → Investigator
         ├─ no material business ambiguity
         │  → Deterministic Evaluation
         │  → AI Risk Classification
         │  → Gap / Remediation Analysis
         │  → Report
         └─ NEEDS_BUSINESS_CONTEXT
            → bounded Targeted Clarification handoff
            → Interview Agent
            → CONTEXT_RESOLVED / BLOCKED_OR_UNRESOLVED
            → Assessment Orchestration validates current origin/state
            → exact Investigator resume or selective rerun/rescope
```

### Canonical mode names

- `INITIAL_INTERVIEW`
- `INVESTIGATOR_RESOLUTION`

`PRE_PLANNER` is a **legacy compatibility alias only**. A compatibility adapter may normalize it to `INITIAL_INTERVIEW` before the canonical Interview runtime/model is invoked. New business logic must not propagate `PRE_PLANNER`.

---

## 3. Core Agent Principle

```text
Interview Agent
= business-context reasoning authority for its own Interview loop

Interview Skills / Rules
= procedural memory + reasoning constraints

Tools
= bounded capabilities

Application / Runtime
= identity, authorization, persistence, schema validation,
  technical coverage gating, versioning, checkpoint/resume,
  audit, exact-origin validation and downstream invalidation

Deterministic code
= guardrails and state integrity, not a second business-reasoning engine
```

The architecture must not reintroduce:

- fixed/fallback business questionnaire;
- Business Fact Catalog required for readiness;
- deterministic required-fact engine;
- deterministic pre-question selector;
- domain-specific readiness checklist;
- rule such as “if AI exists, require facts A/B/C”.

---

## 4. Actors and Authority Boundary

### 4.1 Business actor

**Customer** is the direct business actor of Interview Agent.

Admin does not answer Initial Interview or Targeted Clarification on behalf of the Customer flow merely because the user is an Admin.

Every Customer action still requires the appropriate Workspace/Assessment/resource permission; “Customer” is not a blanket authorization role.

### 4.2 Interview Agent owns

- inspect bounded governed evidence/context made available to it;
- identify material customer-owned business uncertainty;
- select the next useful question;
- clarify ambiguous answers;
- interpret Customer answers;
- propose/update business context through bounded write tools;
- preserve uncertainty/conflict;
- decide Interview sufficiency under Protected Sufficiency Guardrails;
- return typed business outcomes and `DOWNSTREAM_IMPACT` flag when applicable.

### 4.3 Interview Agent does not own

- legal applicability;
- LegalRule or EngineeringRule creation/selection/pinning;
- Planner scope or Investigator technical work;
- technical coverage readiness decision;
- AI Risk Classification;
- compliance verdict;
- selective rerun/rescope decision;
- continuation/checkpoint generation;
- raw repository mutation or PGE mutation;
- cross-tenant access;
- tool permission expansion;
- direct promotion of reusable guidance.

---

## 5. Runtime Authority Model — Business-Level Invariant

The following values are authoritative when supplied by validated runtime/governed state:

- host platform identity;
- subject/assessed system identity;
- assessment identity;
- canonical Interview mode;
- guidance version;
- technical coverage state and limitations;
- current confirmed business context;
- authenticated respondent identity;
- targeted `businessContextNeed`;
- `resolutionCriteria`;
- originating investigation reference;
- governed evidence identity/resolution.

Customer text, scenario text, repository content or prompt content is **content**, not authority.

It must not be able to rewrite runtime identity, mode, assessment identity, guidance version, technical coverage state, targeted need, resolution criteria, originating reference or governed evidence identity.

---

## 6. Technical Coverage Ownership

Technical coverage is owned by **Assessment Orchestration / scanner workflow**, not by Interview Agent.

Canonical coverage semantics:

- `READY` — Interview may run normally.
- `PARTIAL` — Interview may run only when Orchestrator/product policy considers current evidence usable; limitations must be preserved.
- `UNAVAILABLE` — Orchestrator must route to technical recovery/retry/block before Interview is invoked.

### Required interpretation rule

```text
No technical evidence found
≠
business behavior does not exist
```

Missing behavior may exist in another repository, SaaS/vendor service, workflow automation, private service or manual/off-system process.

Interview may ask the Customer only when the remaining uncertainty is both:

1. customer-owned; and
2. material.

Technical/coverage uncertainty must return to the technical workflow rather than being converted into a business question.

---

## 7. Evidence Boundary

Technical/documentary evidence is governed evidence context. It is not automatically Customer-confirmed business truth.

### 7.1 Internal evidence

May include source paths, call chains, metadata and technical observations available under application authorization.

### 7.2 Customer-visible evidence

Customer-facing “Why are we asking?” or related evidence must be a **bounded, authorized and sanitized explanation**.

Default behavior must not expose:

- secrets/tokens;
- unrelated raw source;
- restricted configuration;
- security-sensitive metadata;
- cross-tenant information;
- internal identifiers or technical detail unnecessary to explain the question.

Example:

> “LCSP found a technical path where an AI-generated score appears connected to a rejection action. We need to understand the real business process before that rejection becomes effective.”

---

## 8. Business Context Semantics

Business Context must not mix provenance/source with resolution state.

### 8.1 Provenance / source dimension

- `CUSTOMER_STATED` — the Customer expressed the information, but it has not necessarily become authoritative context.
- `CUSTOMER_CONFIRMED` — the business meaning is directly explicit and semantically lossless, or a non-trivial interpretation was explicitly confirmed.

Technical/documentary evidence is **not** a `contextUpdates.source` value.

### 8.2 Resolution dimension

- `CONFIRMED`
- `UNCERTAIN`
- `CONFLICTED`
- `SUPERSEDED`

Interaction states such as “pending clarification” or “awaiting confirmation” belong to Interview/session state, not to the provenance enum.

### 8.3 Downstream authority

Only context equivalent to:

```text
source = CUSTOMER_CONFIRMED
resolutionState = CONFIRMED
```

may be consumed as authoritative Structured Assessment Context downstream.

`CUSTOMER_STATED`, `UNCERTAIN`, `CONFLICTED` and `SUPERSEDED` items may remain in Interview history/reasoning/audit but must not be consumed as current confirmed business truth.

### 8.4 Scope and respondent provenance

Customer scope must be preserved.

Example:

> “In my team, analysts always approve them.”

must not silently become organization-wide truth.

Each material Customer statement/confirmation/correction/supersession must be traceable to an authenticated respondent.

Different respondents disagreeing creates a conflict unless there is an explicit governed correction/supersession relationship; “later answer wins” is not a default rule.

---

## 9. Question and Confirm/Adjust Semantics

### 9.1 Canonical reasoning intents

- `ASK`
- `CLARIFY`

`CONFIRM` is **not** a third reasoning intent.

### 9.2 Confirm/Adjust is a first-class interaction contract

When a material/non-trivial interpretation needs explicit Customer confirmation, the question remains semantically a clarification but uses a first-class Confirm/Adjust response mode.

Conceptually:

```text
intent = CLARIFY
responseMode = CONFIRM_ADJUST
proposedInterpretation = ...
actions = CONFIRM | ADJUST
```

### 9.3 When explicit confirmation is required

```text
Direct + explicit + semantically lossless
→ CUSTOMER_CONFIRMED directly
→ no redundant confirmation

Pure formatting / presentation normalization
→ no separate confirmation required

Hedged / ambiguous / materially inferred authority, timing, scope or effect
→ clarify and/or Confirm/Adjust
→ authoritative only after meaning is established
```

Prompt injection, refusal or non-answer is not converted into `CLARIFY` merely because the system is retrying; the next question should reflect the actual unresolved business need.

---

## 10. Initial Interview

### Entry

Initial Interview starts only after Minimal Project Setup, source configuration, Scanner/PGE and a usable technical coverage decision.

### Input categories

- validated runtime identity/context;
- PGE / bounded governed evidence;
- coverage limitations;
- current confirmed business context;
- Interview history;
- pinned Interview Skills/Rules;
- session-local Working Strategy.

EngineeringRules are not an Initial Interview reasoning input.

### Goal

Establish enough baseline Customer business context for the workflow to move to the EngineeringRule stage without requiring a material Customer-owned business assumption to be invented.

### Allowed outcomes

- `WAITING_FOR_CUSTOMER`
- `CONTEXT_READY`
- `BLOCKED_OR_UNRESOLVED`
- `FAILED`

`CONTEXT_RESOLVED` is invalid in Initial Interview.

---

## 11. Targeted Clarification / Investigator Resolution

### Entry

Investigator returns `NEEDS_BUSINESS_CONTEXT`.

The bounded business handoff to Interview contains conceptually:

```text
businessContextNeed
whyNeeded?                    // customer-safe / business-operational explanation
resolutionCriteria
relatedEvidenceRefs?
originatingInvestigationReference
```

### Boundary

`resolutionCriteria` describes the **business-operational distinction** that must be established. It must not reveal EngineeringRule/legal intent or prescribe the desired answer.

Opaque continuation/checkpoint remains owned by Assessment Orchestration and does not enter Interview reasoning context.

### Goal

Resolve only the material business ambiguity blocking the originating investigation.

### Allowed outcomes

- `WAITING_FOR_CUSTOMER`
- `CONTEXT_RESOLVED`
- `BLOCKED_OR_UNRESOLVED`
- `FAILED`

`CONTEXT_READY` is invalid in Investigator Resolution.

### Resolution rule

Interview must not return `CONTEXT_RESOLVED` merely because the topic was discussed.

It may return `CONTEXT_RESOLVED` only when:

- the exact `businessContextNeed` has been established;
- the business-operational `resolutionCriteria` is satisfied;
- the required bounded context is Customer-confirmed;
- no directly coupled material ambiguity changes the interpretation.

After that, Orchestrator still validates current origin/state before any resume.

---

## 12. Materiality and Sufficiency

### 12.1 Materiality

A Customer-owned uncertainty is material only when meaningfully different plausible answers could change at least one of:

- a handoff-relevant normalized business fact;
- `CONTEXT_READY` / `CONTEXT_RESOLVED`;
- relevance/meaning/priority of another material frontier;
- interpretation of a consequential business action/decision;
- Investigator continuation eligibility;
- downstream reconsideration.

Descriptive detail alone is not material merely because the stored text would differ.

### 12.2 Frontier priority

After filtering for customer-owned + material:

1. dependency / branching blocker;
2. unresolved authority / timing / effect of consequential action;
3. material relied-on conflict/ambiguity;
4. actual real-world use;
5. data/deployment/operational scope;
6. other material business context.

Within the same priority level, prefer the smallest question, strongest evidence grounding and highest expected uncertainty reduction.

In Investigator Resolution, the supplied `businessContextNeed` is always the scope anchor.

### 12.3 Protected Sufficiency Guardrails

Interview must **not** return `CONTEXT_READY` while any of the following is true:

1. open material + customer-owned uncertainty remains;
2. readiness depends on a non-trivial material Customer interpretation that is not established;
3. a material evidence/Customer conflict is unresolved or improperly discarded;
4. stale/invalid evidence is being used to justify readiness;
5. documentary/technical evidence is treated as Customer-confirmed operational reality;
6. a known technical coverage limitation leaves a handoff-relevant business frontier materially unknowable or unsafe to assume;
7. readiness requires inventing a business assumption.

These are generic invariants, not a required-fact catalog.

---

## 13. Outcomes and State Transition Matrix

`DOWNSTREAM_IMPACT` is a **flag**, not an outcome.

| Mode | Outcome | Business meaning | Assessment Orchestration action |
| --- | --- | --- | --- |
| INITIAL_INTERVIEW | WAITING_FOR_CUSTOMER | Interview knows the next useful question and waits for Customer input. | Persist turn/checkpoint; show waiting state in Workflow Run. |
| INITIAL_INTERVIEW | CONTEXT_READY | Baseline business context is sufficient under guardrails. | Freeze/current confirmed context revision; continue to EngineeringRule stage. |
| INITIAL_INTERVIEW | BLOCKED_OR_UNRESOLVED | Required business reality cannot currently be established reliably. | Persist unresolved state; do not fabricate or auto-complete. |
| INITIAL_INTERVIEW | FAILED | Runtime/system/contract failure. | Route to system recovery/error handling; do not treat as Customer uncertainty. |
| INVESTIGATOR_RESOLUTION | WAITING_FOR_CUSTOMER | Targeted clarification needs Customer input. | Keep originating investigation suspended; persist/checkpoint targeted Interview. |
| INVESTIGATOR_RESOLUTION | CONTEXT_RESOLVED | Exact business ambiguity is resolved. | Validate originating reference/current context and exact continuation; resume only if still valid. |
| INVESTIGATOR_RESOLUTION | CONTEXT_RESOLVED + DOWNSTREAM_IMPACT | Clarification changed prior confirmed context enough to stale downstream work. | Do not blindly exact-resume; compute selective invalidation/rerun/rescope first. |
| INVESTIGATOR_RESOLUTION | BLOCKED_OR_UNRESOLVED | Business ambiguity still cannot be established. | Keep investigation blocked with explicit unresolved business context. |
| INVESTIGATOR_RESOLUTION | FAILED | Runtime/system/contract failure. | Route to system recovery/error handling. |

Invalid outcome/mode combinations must be rejected by the technical contract.

---

## 14. BLOCKED_OR_UNRESOLVED

This is a controlled business outcome, not a system error and not a fabricated completion.

Semantic stop condition:

```text
Customer explicitly cannot currently provide more information
+
current governed evidence cannot resolve the material ambiguity
→ BLOCKED_OR_UNRESOLVED
```

Do not use retry count as a substitute for meaning.

MVP Customer actions:

- **Provide more context**
- **I need to check internally**
- **Save & Exit**

New Customer information or new governed evidence may allow the Interview to reopen later.

---

## 15. Downstream Impact, Resume and Learning

### 15.1 Downstream impact

Interview may identify/flag `DOWNSTREAM_IMPACT`.

Interview does **not** choose:

- affected EngineeringRules;
- affected Planner/Investigator nodes;
- rerun granularity;
- invalidated result set.

Assessment Orchestration owns dependency/provenance/staleness analysis and selective rerun/rescope.

### 15.2 Save & Exit / resume

A pending Interview must preserve thread/progress.

On return, the application must revalidate relevant source/PGE/context/origin state before reusing the pending question.

Do not restart the whole Initial Interview solely because the Customer returned.

### 15.3 Learning

MVP:

- pinned guidance version;
- guidance traceability;
- session-local Working Strategy;
- optional improvement/learning proposal;
- no self-modification.

Phase 2:

```text
proposal
→ offline/baseline evaluation
→ safety + regression gates
→ canary
→ promote / reject / rollback
```

Interview Agent does not own promotion authority.

Protected Rule/authority/security changes must never direct-auto-promote.

---

## 16. Frozen Business Invariants

The following are frozen and may not be changed by Technical Design without reopening Product/BA review:

1. One reusable Interview Agent with two canonical modes: `INITIAL_INTERVIEW` and `INVESTIGATOR_RESOLUTION`.
2. `PRE_PLANNER` is legacy alias only.
3. Scan/PGE precedes Initial Interview after Minimal Project Setup.
4. EngineeringRule is not Interview reasoning input.
5. No fixed questionnaire, required-fact engine or mandatory Business Fact Catalog.
6. Interview Agent owns question selection, clarification and sufficiency reasoning.
7. Deterministic code owns guardrails/state integrity, not business-question reasoning.
8. Orchestrator owns technical coverage readiness, exact continuation, downstream invalidation and selective rerun/rescope.
9. `UNAVAILABLE` must not reach Interview; permitted `PARTIAL` may.
10. Missing technical evidence never proves absence of business behavior.
11. Customer-safe evidence is bounded/authorized/sanitized; raw evidence is not the default UI disclosure.
12. Context provenance and resolution are separate dimensions.
13. Only Customer-confirmed + confirmed-resolution context is authoritative downstream.
14. Material statement/confirmation/correction/supersession is traceable to authenticated respondent provenance.
15. Semantic question intents remain `ASK | CLARIFY`; Confirm/Adjust is a first-class response interaction for material interpretation.
16. Pure formatting/lossless direct meaning does not require redundant confirmation.
17. Targeted clarification requires business-operational `resolutionCriteria`.
18. Opaque continuation/checkpoint is Orchestrator-owned and not Interview reasoning context.
19. `DOWNSTREAM_IMPACT` is a flag, not an outcome.
20. `BLOCKED_OR_UNRESOLVED` is a controlled business outcome distinct from `FAILED`.
21. No retry-count auto-completion.
22. Workflow Run is the single Customer-facing progress/activity surface; internal Interview mode is not a separate badge/state.
23. Learning promotion is Phase 2 and separate from Interview authority.
24. Protected Sufficiency Guardrails prevent false READY/RESOLVED without creating a questionnaire engine.

---

## 17. Canonical Technical Contract — Work to Do Next

The following are **technical-contract decisions**, not open business-architecture questions:

1. Exact `InterviewRuntimeResult` envelope fields and serialization.
2. Exact `InterviewAgentInput` DTO and compatibility normalization for `PRE_PLANNER`.
3. Discriminated-union schema for each result outcome.
4. Exact confirmed-context type and compile/runtime validation.
5. Concrete `BusinessContextScope` object shape while preserving extensibility.
6. Stable `ChoiceOption { value, label }` schema.
7. Locale/language-preference field representation.
8. `CustomerAnswer` union for free text/select/boolean/Confirm-Adjust.
9. Exact question payload for `ASK`, `CLARIFY` and `CONFIRM_ADJUST` response mode.
10. Runtime validator rules for authority-changing/untrusted prompt fields.
11. Persistence model for session/turn/context revision/provenance/audit.
12. Event names and Workflow Run mapping.
13. Orchestrator implementation of the frozen State Transition Matrix.
14. Exact `PARTIAL` technical coverage policy/config representation.
15. Stale-origin/continuation validation mechanics.
16. Safe-evidence DTO split between governed internal evidence and Customer-visible summary/snippet.
17. LangGraph/service/node/API boundaries.
18. Regression/eval mapping for all frozen P0/P1 behaviors.

Technical Design may choose names/structures, but it must preserve the frozen business invariants.

---

## 18. Freeze Review

| Area | Review result | Freeze status |
| --- | --- | --- |
| End-to-end flow | Minimal Setup → Scan/PGE → Interview → ER → Planner → Investigator; targeted re-entry defined. | FROZEN |
| Actor/authority boundary | Customer interaction vs Orchestrator/ER/Planner/Investigator ownership is explicit. | FROZEN |
| Canonical modes | `INITIAL_INTERVIEW` / `INVESTIGATOR_RESOLUTION`; legacy alias isolated. | FROZEN |
| Technical coverage | Owner, READY/PARTIAL/UNAVAILABLE boundary and absence-of-evidence rule defined. | FROZEN |
| Evidence usage | Evidence is clue, not business truth; Customer-safe disclosure defined. | FROZEN |
| Business context semantics | Provenance, resolution, authority, scope and respondent provenance separated. | FROZEN |
| Confirmation behavior | OD-04 preserved; Confirm/Adjust first-class without adding a third reasoning intent. | FROZEN |
| Initial sufficiency | Materiality + Protected Sufficiency Guardrails defined without required-fact engine. | FROZEN |
| Targeted clarification | Need, resolution criteria, origin reference and continuation ownership defined. | FROZEN |
| Outcome semantics | WAITING / READY / RESOLVED / BLOCKED / FAILED and impact flag are distinct. | FROZEN |
| Orchestration transitions | Canonical State Transition Matrix defined. | FROZEN |
| Downstream impact | Interview flags; Orchestrator computes rerun/rescope. | FROZEN |
| Audit/provenance | Authenticated respondent and revision traceability defined. | FROZEN |
| UI boundary | Workflow Run is single progress surface; controlled blocked actions defined. | FROZEN |
| Learning | MVP vs Phase 2 boundary and promotion authority defined. | FROZEN |

### Final verdict

**GO — Interview Agent business architecture is sufficiently frozen to move to the Canonical Technical Contract.**
