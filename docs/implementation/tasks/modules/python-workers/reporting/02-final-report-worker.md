---
task_id: MW-rep-002
module: python-workers/reporting
runtime: deepagents
priority: P1
status: READY_FOR_DEV
epic_story: 8.3
depends_on:
  - python-workers/reporting/01-gap-analysis-report-worker.md
  - python-workers/llm/01-llm-gateway-client.md
---

# Final Report Worker

## Outcome

Consume `document.final-report-requested` events and generate a final report using `ClassificationResult` (with `guardrailStatus = passed`) + `VerifiedProfile`. LLM used for rationale narration. Output guardrail blocks overclaim. Uploaded to object storage.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/reports/reporting/final_report_consumer.py` | Create | `ConsumerBase` for `document.final-report-requested` |
| `deepagents/tools/reports/reporting/final_report_generator.py` | Create | Final report with LLM narration |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `reporting.document-final-report-requested` |
| Routing key | `document.final-report-requested` |
| PBAC preflight | No (system event) |

## Final Report Structure

```
Title: "AI System Compliance Assessment Report — <Assessment Name>"
Label: NOT "final" in classification sense — final submission artifact

Sections:
1. Executive Summary (LLM-generated from structured data)
2. AI System Description (from WizardProfile)
3. Technical Evidence Summary (from TechnicalProfile — no source code)
4. Verified AI Usage (from VerifiedProfile)
5. Legal Rule Applicability Analysis (from LegalRuleMatch + ClassificationResult)
6. Citations and Legal References (cited chunk IDs → human-readable refs)
7. Assessment Limitations and Uncertainty
8. Appendix: Evidence Provenance
```

## Business Rules

1. Verify `ClassificationResult.guardrailStatus = passed` before generating.
2. LLM prompt: structured evidence metadata only (no raw source, no full AST).
3. Run `PromptSafetyCheck` before every LLM call.
4. Run `OutputGuardrail.check(content)` — block if overclaim.
5. Upload to object storage if passed.
6. Callback to NestJS with `status = READY` or `status = BLOCKED`.
7. Report must not imply legal certification, compliance approval, or production readiness.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Classification `guardrailStatus = passed` | Report generated |
| T02 | Report contains `certified` | `BLOCKED` by output guardrail |
| T03 | LLM prompt contains source code | `PromptSafetyViolation` |
| T04 | Budget exceeded | `BudgetExceeded`, `status = FAILED` |
| T05 | Report has citation references | Citations traceable to chunk IDs |

## Definition of Done

- Final report uses LLM for narration from structured data only — no raw source.
- `guardrailStatus = passed` required before generation.
- Output guardrail blocks all overclaim wording.
- Citations traceable to approved corpus chunks.
