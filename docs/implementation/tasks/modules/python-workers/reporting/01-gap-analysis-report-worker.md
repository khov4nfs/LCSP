---
task_id: MW-rep-001
module: python-workers/reporting
runtime: deepagents
priority: P1
status: READY_FOR_DEV
epic_story: 8.1
depends_on:
  - python-workers/classification/01-classification-worker.md
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# Gap Analysis Report Worker

## Outcome

Consume `document.gap-analysis-requested` events and generate a GapAnalysis document from `ClassificationResult` + `WizardProfile`. Apply output guardrail. Upload to object storage. Callback to NestJS with document URL. Never overclaim certification or compliance.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/reports/reporting/__init__.py` | Create | Package init |
| `deepagents/tools/reports/reporting/gap_analysis_consumer.py` | Create | `ConsumerBase` for `document.gap-analysis-requested` |
| `deepagents/tools/reports/reporting/gap_analysis_generator.py` | Create | GapAnalysis document generation |
| `deepagents/tools/reports/reporting/output_guardrail.py` | Create | Overclaim detector shared by all report workers |
| `deepagents/tools/reports/reporting/storage_uploader.py` | Create | Object storage upload + pre-signed URL generation |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `reporting.document-gap-analysis-requested` |
| Routing key | `document.gap-analysis-requested` |
| RBAC preflight | No (system event) |

## GapAnalysis Document Structure

```
Title: "Gap Analysis — <Assessment Name>"
Label: "Wizard Readiness and Legal Gap Analysis"
[NOT: final, classification, certified, compliant]

Sections:
1. Assessment Context (from WizardProfile — business language only)
2. Technical Evidence Summary (from TechnicalProfile — no source code)
3. Identified AI Usage Patterns (from ClassificationResult — claim types only)
4. Legal Rule Applicability (from LegalRuleMatch — cited rules)
5. Missing Evidence / Coverage Gaps (from tool_failures + coverage_notes)
6. Recommended Next Steps (business language)
```

## Business Rules

1. Fetch `DocumentRequest`, `ClassificationResult`, `WizardProfile` from NestJS API.
2. Generate document content (plain Markdown or PDF).
3. Run `OutputGuardrail.check(content)` — block if `certified`, `validated`, `compliant`, `non-compliant`, `approved`, `production ready` detected.
4. If blocked: update `DocumentRequest.status = BLOCKED` via API callback. Log guardrail reason.
5. If passed: upload to object storage (S3/MinIO), get `document_url`.
6. Submit callback to NestJS `PATCH /internal/document-requests/:id` with `{ status: READY, document_url }` or `{ status: BLOCKED, blocked_reason }`.
7. No raw source code in document content.
8. No LLM calls for GapAnalysis — pure structured template from evidence data.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Valid classification result | Document generated, uploaded, `status = READY` |
| T02 | Content contains `certified` | Guardrail blocks, `status = BLOCKED` |
| T03 | No raw source code in document | Content inspection |
| T04 | Upload fails | Job fails, retried, or `status = FAILED` |
| T05 | Document title has no risk labels | Title field inspection |
| T06 | No LLM calls | Network trace |

## Definition of Done

- GapAnalysis generated without LLM calls (template-based).
- Output guardrail blocks overclaim wording.
- Uploaded to object storage; URL returned to NestJS.
- No raw source code in document.
