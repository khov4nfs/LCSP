---
task_id: MW-web-006
module: web
runtime: nextjs
priority: P1
status: READY_FOR_DEV
epic_story: 7.3
depends_on:
  - document/03-get-document-status-endpoint.md
  - web/05-classification-status-page.md
---

# Document Download Page

## Outcome

Show all documents for an assessment (GapAnalysis, FinalReport, ReadinessExport). Display status per document. When ready, show download button with pre-signed URL. Show blocked/failed states with business-language explanation.

## Module Files

| File                                                           | Action | Notes                       |
| -------------------------------------------------------------- | ------ | --------------------------- |
| `apps/web/app/(workspace)/assessments/[id]/documents/page.tsx` | Create | Document list page          |
| `apps/web/components/ui/document-card.tsx`                     | Create | Per-document status card    |
| `apps/web/lib/api/document-client.ts`                          | Create | Document status API wrapper |

## UI States per Document

| Status       | Display                                               |
| ------------ | ----------------------------------------------------- |
| `QUEUED`     | "Being prepared..." (spinner)                         |
| `GENERATING` | "Generating..." (spinner)                             |
| `READY`      | "Download" button (opens pre-signed URL)              |
| `FAILED`     | "Generation failed. Please try again." (retry button) |
| `BLOCKED`    | "Document blocked — [business-language reason]"       |

## Business Rules

1. Poll document status every 5s when status is `QUEUED` or `GENERATING`.
2. Stop polling when status changes to `READY`, `FAILED`, or `BLOCKED`.
3. Download button opens `download_url` in new tab. URL expires in 5 minutes — refetch before download if stale.
4. FinalReport download not available to non-Manager scope.
5. `blocked_reason` shown as-is (already business language from API).
6. No document content preview in browser — download only.

## Test Cases

| ID  | Scenario                                   | Expected                      |
| --- | ------------------------------------------ | ----------------------------- |
| T01 | QUEUED document                            | Spinner shown, polling active |
| T02 | READY document                             | Download button shown         |
| T03 | BLOCKED document                           | Blocked message with reason   |
| T04 | Download URL expired                       | Refetch before click          |
| T05 | Non-Manager accessing FinalReport download | Button hidden or 403          |
| T06 | Polling stops on READY                     | No more API calls after READY |

## Definition of Done

- Status polling active for QUEUED/GENERATING.
- Download via pre-signed URL (refetch if stale).
- FinalReport restricted by RBAC scope.
- Blocked/failed states with business-language message.
