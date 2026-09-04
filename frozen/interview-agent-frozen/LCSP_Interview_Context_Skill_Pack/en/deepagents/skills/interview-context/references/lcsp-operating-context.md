# LCSP Operating Context

For canonical runtime/evidence/reasoning vocabulary, read `terminology-contract.md`.


Use this reference to understand the environment in which Interview Agent operates.

## 1. LCSP

LCSP is a software assessment platform.

A customer connects a software system or repository. LCSP scans the implementation, builds evidence about how the system behaves, asks the customer for business reality that code cannot reliably prove, and then performs downstream legal/technical assessment work.

Interview Agent is one specialist inside this larger flow.

## 1.1. Assessed System

The **Assessed System** is the software/repository currently being evaluated by LCSP.

It is the subject of the PGE and business context.

Example:

```text
host platform:
LCSP

assessed system:
github:customer/recruitment-ai@abc123
```

Dogfooding may produce:

```text
host platform:
LCSP

assessed system:
github:khovan123/LCSP@0298ef4
```

Matching names do not merge authority scopes.

Knowledge in this Skill/reference about the LCSP host platform is not evidence or customer-confirmed fact about the Assessed System.

The runtime must provide a clear assessment-bound identity such as `subjectSystemIdentity`, snapshot/commit, or equivalent system reference.

## 2. Assessment

An **Assessment** is one governed evaluation of a customer's connected software/source version.

An Assessment has:

- a customer/tenant boundary;
- current repository/source identity;
- scan/PGE artifact versions;
- structured business context;
- downstream legal/EngineeringRule/investigation state;
- checkpoint/resume state;
- audit history.

Interview Agent must stay inside the current Assessment boundary.

## 3. Customer

**Customer** means the authenticated organization user answering LCSP's business-context questions.

The Customer is authoritative for facts about real operational practice, for example:

- who actually approves a decision;
- whether an AI output is advisory or final;
- whether a manual review happens outside the repository;
- how staff use a feature;
- who is affected by an outcome.

The Customer is not automatically authoritative for repository facts that governed evidence can establish directly.

Keep source roles separate.

## 4. Scanner

The **Scanner** analyzes the connected software implementation before Initial Interview.

It can discover technical facts such as:

- source structure;
- routes/calls/events;
- data movement;
- AI provider/model invocations;
- status changes;
- approval/rejection paths;
- human-review or override paths;
- unresolved dynamic behavior.

Interview Agent does not run repository exploration itself. Consume bounded governed evidence.

## 5. Program Evidence Graph (PGE)

The **Program Evidence Graph** is LCSP's provenance-backed graph of system evidence.

Current architecture treats technical and business-system semantics as logical layers in one graph, including:

- source/provenance;
- code structure;
- runtime/framework boundaries;
- data lineage;
- AI system/model lifecycle;
- business-process semantics;
- decision influence/human oversight;
- evidence confidence/origin/resolution state.

Evidence can have states such as:

- `OBSERVED`;
- `CORROBORATED`;
- `INFERRED`;
- `UNRESOLVED`.

An LLM-derived business semantic is not customer-confirmed business reality merely because it exists in PGE.

PGE does not establish legal applicability.

## 5.1. Documentary business evidence

**Documentary business evidence** is business-semantic information found in repository artifacts such as README files, product briefs, ADRs, design documents, comments, configuration, or specifications.

A repository statement:

> “System is decision support only.”

supports:

```text
repository documentation describes the system as decision support
```

It does not automatically support:

```text
Customer confirmed the system is actually operated as decision support
```

Use documentary evidence to ask better questions, detect documentation/operation drift, and reduce generic interviewing. Never normalize it into confirmed business context without customer confirmation.

## 6. Business context

**Business context** is structured knowledge about how the system is actually used and what its actions mean in the customer's organization.

Examples:

```text
purpose:
AI ranks incoming job applications.

decision role:
AI recommends a ranking; it does not make the final hiring decision.

final authority:
A recruiter chooses whether to reject an applicant.

human review:
Every rejection must be reviewed before it becomes final.

affected subjects:
Job applicants.

off-system process:
Senior-role applications also require a phone review not represented in code.
```

Business context may include uncertainty or conflict.

Do not require every possible topic to be filled.

## 7. Structured Assessment Context

The **Structured Assessment Context** is the authoritative persisted representation of customer-established business context used by downstream assessment stages.

Interview conversation is not itself the authoritative context.

A raw answer may need interpretation/confirmation before it becomes confirmed structured context.

Keep history when a value is corrected or superseded.

## 8. EngineeringRule

An **EngineeringRule** is a reusable technical investigation contract prepared from governed legal material.

It translates a legal/operational obligation into bounded technical questions and evidence targets.

Examples of downstream EngineeringRule concerns can include:

- whether a human review control exists before a consequential final action;
- whether an override path exists;
- whether required logging/traceability controls exist.

EngineeringRule is downstream from Initial Interview.

Interview Agent does not:

- select EngineeringRules;
- determine their applicability;
- read them to choose customer questions;
- decide whether they are satisfied.

This separation prevents Interview from becoming a hidden legal/applicability agent.

## 9. EngineeringRule stage

After Initial Interview returns `CONTEXT_READY`, LCSP performs its governed EngineeringRule/legal-readiness/applicability preparation according to the assessment architecture.

Treat this as a downstream boundary.

Interview hands off business context; it does not participate in rule selection.

## 10. Planner

The **Planner** is a downstream technical specialist.

It receives the applicable/pinned EngineeringRule work and relevant assessment/PGE context, then produces the smallest bounded technical investigation plan.

Planner does not own customer Interview.

## 11. Investigator

The **Investigator** executes the Planner's bounded technical investigation using governed PGE/evidence tools.

Its job is to establish provenance-backed technical facts.

When one necessary fact is not technical but business-operational and cannot be established from evidence, Investigator may return:

```text
NEEDS_BUSINESS_CONTEXT
```

The originating side converts that into a bounded customer clarification request.

Interview Agent receives the business need, not the EngineeringRule itself.

## 12. Assessment Orchestrator

The **Assessment Orchestrator** owns workflow mechanics, including:

- which stage runs;
- checkpointing;
- waiting/resume;
- exact investigation reference;
- stale-context/evidence checks;
- downstream invalidation/re-run routing;
- audit correlation.

Interview Agent may signal an outcome or downstream impact but does not arbitrarily choose the next pipeline stage.

## 13. Verified Interview episodes

A **Verified Interview Episode** is a previously validated example of a successful Interview strategy.

It may teach strategy such as:

- a useful clarification pattern;
- an effective question ordering;
- a common ambiguity pattern.

It is never factual evidence for the current customer's Assessment.

Never copy another customer's business facts into current context.

## 14. Canonical authority map

```text
Repository/PGE evidence
    authority for governed technical observations
            │
            │ may motivate questions
            ▼
Interview Agent + Customer
    authority for customer-confirmed business context
            │
            ▼
EngineeringRule / Planner / Investigator
    authority for downstream technical investigation work
            │
            ▼
Governed evaluator
    authority for compliance/evaluation outcome
```

No one layer should silently assume another layer's authority.

## 15. Canonical Interview handoffs

### Initial Interview

Input conceptually includes:

```text
assessment identity
PGE/evidence context
current confirmed business context
Interview history
Interview guidance version
```

Output outcome:

```text
WAITING_FOR_CUSTOMER
or CONTEXT_READY
or BLOCKED_OR_UNRESOLVED
or FAILED
```

Optional flag:

```text
DOWNSTREAM_IMPACT
```

### Investigator clarification

Input conceptually includes:

```text
businessContextNeed
relevant evidence refs/context
current confirmed business context
Interview history
originating investigation reference
```

Output outcome:

```text
WAITING_FOR_CUSTOMER
or CONTEXT_RESOLVED
or BLOCKED_OR_UNRESOLVED
or FAILED
```

Optional flag:

```text
DOWNSTREAM_IMPACT
```

EngineeringRule text/IDs are not needed in model-visible Interview reasoning.
