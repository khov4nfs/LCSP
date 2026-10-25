# LCSP — Business Logic Documentation Standard

**Status:** Mandatory for all new or modified production business logic.  
**Applies to:** API handlers, commands, queries, domain entities/services, decision/policy/validation functions, assessment/authorization lifecycle logic, frontend feature business logic, shared business contracts, and Python agent runtime logic.

## Goal

A maintainer should be able to read **what a function is allowed to do, why it does it, and what can go wrong** _before_ reading the implementation. A class-level description, a type-only `@param` comment or a restatement such as “Handles data” **does not** document the function's business behavior.

The policy is **function-level**. Document each entrypoint and any named helper implementing an independent business decision. The comment must be placed immediately **before the declaration** in TypeScript/JavaScript (JSDoc) or as the **first statement** in a Python function (docstring). Do not place documentation after business statements. Update it whenever business semantics change.

## Five mandatory sections (exact heading names)

| Section               | Required information                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business purpose:** | The business capability and **observable outcome** in one or two meaningful sentences                                                                                        |
| **Business rules:**   | Authorization, eligibility, invariants, thresholds, sequencing, idempotency, privacy, regulatory or other constraints; explicitly state when no additional constraints exist |
| **Execution flow:**   | Ordered business steps (normally 2–5); describe inputs/decisions/outputs at the correct abstraction level, not individual programming statements                             |
| **Failure cases:**    | Conditions that reject, fail closed, retry, roll back, or return an empty result; name stable error codes where relevant; if none, explain why                               |
| **Side effects:**     | Database/state mutations, transactions, audit/events, notifications, external API calls or **None: pure/read-only** with a reason                                            |

In addition to these headings, conventional JSDoc tags such as `@param`, `@returns` and `@throws` are allowed. These do **not** replace the business headings.

Every section must contain meaningful content, not `TODO`, `N/A`, a function name, or a generic repetition of the code. Use English technical language consistently with the LCSP codebase. Never add secrets or personal information in comments.

### TypeScript / JavaScript

Write this **before the method/function** (not merely before the class):

```ts
/**
 * Business purpose: Open a customer-owned assessment with a durable lifecycle.
 *
 * Business rules:
 * - Only eligible authenticated customers can create and own an assessment.
 * - Persisted assessment, audit and outbox creation must commit together.
 *
 * Execution flow:
 * 1. Validate the request and construct a new assessment aggregate.
 * 2. Initialize its runtime state and transition the lifecycle inside one transaction.
 * 3. Record the audit and outbox event, then return the persisted projection.
 *
 * Failure cases:
 * - Invalid input is rejected using the shared assessment request error code.
 * - Any transaction failure aborts all related writes without partial success.
 *
 * Side effects:
 * - Creates assessment, lifecycle and audit records and queues one outbox event.
 */
async execute(command: CreateAssessmentCommand): Promise<CreateAssessmentDto> {
  // Implementation follows the business contract above.
}
```

Use the same format above other business-bearing methods, exported functions and named arrow functions. If the function has **one small step**, one meaningful ordered step is accepted; multi-step orchestration should explain the relevant ordering.

### Python agents

Place the same five sections in a **docstring at the top of the function**:

```python
def evaluate_dataset(path: Path) -> dict[str, Any]:
    """Business purpose: Evaluate frozen decisions before any model promotion.

    Business rules:
    - An evaluation must preserve the exact dataset and model version.
    - Policy and safety constraints must gate any recommendation to promote.

    Execution flow:
    1. Load and fingerprint the frozen response dataset.
    2. Aggregate results, errors and quality measures by decision class.
    3. Apply the existing model activation policies to the report.

    Failure cases:
    - Invalid fixtures cause an error rather than fabricated quality metrics.

    Side effects:
    - None: calculations use frozen inputs and return a report in memory.
    """
    # Implementation follows this documented contract.
```

### What not to do

**Rejected example:**

```ts
/** Handles data. */
async execute(command: Command) { /* ... */ }
```

A valid comment should explain the **business invariant or decision**, not merely repeat code tokens such as “call repository”, “check input”, or “return response”. Mention side effects and errors even when they occur in injected repositories or external services.

## Scope and checks

- The standard is a **repository-wide human and AI-agent rule**, including TypeScript and Python.
- The automated checker currently covers named functions/methods and named arrow functions in API `application`/`domain`, relevant service/policy/handler adapters, Web feature hooks/utils/services/stores/client logic, Next API route handlers, shared contract code, and Python `deepagents` / `deepagents-langgraph` production source.
- Anonymous inline callbacks and business logic hidden in UI components are not always inferred by the checker. Reviewers must still require the same contract where business decisions are embedded there; ideally extract such logic into a named function.
- Constructors used only for dependency injection, generated code, tests, fixtures and purely technical plumbing outside business ownership do not require this full format.
- When a named function in a business-owned module is merely a technical helper, prefer extracting it to an appropriate technical module. Do **not** write misleading business documentation to pass automation.

### Local commands

```bash
pnpm run check:business-logic-docs
pnpm run test:business-logic-docs
pnpm run check:business-logic-docs -- --audit
```

The main check parses TypeScript/JavaScript via the TypeScript compiler API and Python via `ast`. It verifies comment location, exact headings, non-empty business descriptions, bullets and ordered flow steps. **Automation cannot certify semantic correctness**: reviewers must compare documentation with tests, contracts and real code behavior.

### Legacy migration (mandatory for changes, gradual for untouched code)

The initial introduction finds **2,306 historical functions** without this full format (512 API, 449 Web, 39 shared contracts and 1,306 Python agents). `scripts/business-logic-docs-baseline.json` records their original named function and source-code fingerprint so that untouched functions can remain temporarily while other work proceeds.

The checker rejects an **added** business function, a **changed implementation** of a legacy function without the new format, or a malformed new comment. The exception applies only while the exact legacy implementation remains unchanged; unrelated edits elsewhere in the file do not force arbitrary refactoring.

- Never regenerate or expand the baseline as part of a normal PR or agent fix.
- Migrate adjacent legacy functions when changing their behavior; do not invent business rules to improve the number.
- Require explicit engineering review for any baseline/schema migration.
- Before merging, confirm `pnpm run check:business-logic-docs` passes in CI.

An optional strict/audit scan exposes the remaining documentation backlog without treating it as complete:

```bash
pnpm run check:business-logic-docs -- --strict --audit
```

## Review criteria

A reviewer should be able to answer these questions from the header alone: Which actor/aggregate is involved? Which rule is enforced? What are the steps and their sequence? What causes a business rejection? Which state or external systems change? Do comments match actual execution, negative-path tests, transaction boundaries and API error contracts?

The header describes the **business contract**; technical implementation details that do not change business behavior belong next to the relevant code instead. Do not document each line merely to inflate coverage.
