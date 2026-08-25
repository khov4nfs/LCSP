# Orchestration State Machine

```mermaid
flowchart TD
  A[Scan command] --> B[Mandatory deterministic baseline]
  B --> C[Evidence index and coverage]
  C --> D[Planner]
  D --> E[Technical / Wizard / Similarity agents]
  E --> F{Typed outcome}
  F -->|READY| G[Conflict-free evidence context]
  F -->|NEEDS_INPUT| H[Resolver map]
  H --> D
  F -->|CONFLICT| G
  F -->|OUT_OF_COVERAGE| I[Targeted deterministic reanalysis]
  I --> D
  F -->|BLOCKED| J[Checkpointed blocked state]
  G --> K[EngineeringRule planning and legal citations]
  K --> L{Legal corpus and rules ready?}
  L -->|yes| M[Direct EngineeringRule assessment]
  L -->|no| N[Admin-managed corpus recovery]
  N --> O[Validated immutable corpus activation]
  O --> K
  M --> P[Deterministic classification gates]
  P --> Q[Gap matrix evaluation]
  Q --> R[Persisted result or explicit gap/block]
```

## Agent outcome contract

```json
{
  "status": "NEEDS_INPUT",
  "missingInputs": [{
    "requirementId": "HUMAN_REVIEW_EVIDENCE",
    "subjectRef": "symbol:...",
    "requiredFor": "wizard.humanReview",
    "allowedResolvers": ["inspect_human_review_path", "trace_static_flow"],
    "priority": "HIGH"
  }],
  "coverageState": "SUFFICIENT",
  "evidenceRefs": ["ev:..."],
  "limitations": []
}
```

The orchestrator validates this schema, checks the resolver allow-list, budget, PBAC context, idempotency key, and checkpoint before invoking a resolver. It never interprets free-form agent prose as authority.
