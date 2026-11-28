# LCSP-418 — Legal source version and document lifecycle

Delivery status: implemented UI and purpose transport; **not accepted for production lifecycle/legal acceptance**. Activation intentionally fails closed pending backend admission under LCSP-424/425. This is a follow-up to LCSP-391.

The supplied ticket and Figma states are the requirements used here. SRS v35 was not available; the requester explicitly waived the missing checklist on 2026-11-28. No Jira status was changed.

## Root cause

The existing management UI provided inline ingestion forms and a generic activation confirmation, with limited provenance and deletion impact detail. Technical readiness (`READY` documents and a valid structural index) was enough to expose activation, although the management API has no official Vietnamese-source admission result. Upload/import also could not persist a selected document purpose at creation time, despite an existing corpus-role model.

## Fix

Reuse the existing source/version routes, shared shell, exact production `LCSPLogo`, theme tokens, cards, buttons, fields, badges and dialogs. Add version lineage/identity, purpose-aware upload/import dialogs, processing attempt/status, provenance disclosure, a readiness review, and a deletion impact/result view. Keep all server capability checks and transactional deletion checks authoritative.

Purpose maps to existing `OPERATIVE` / `REFERENCE_ONLY` corpus roles. It travels through React Hook Form/Zod, the authenticated BFF, shared request schemas, the existing document service, Prisma enum mapping and the document upload/import audit payload. Omitted purpose preserves legacy `OPERATIVE` behavior; purpose is **not** legal admission. No database migration is necessary.

Deletion requires an eligible successful impact snapshot, reason and matching source slug. Impact errors/refetches disable submission. Rejected deletion refreshes impact and clears confirmation. Retries of the same payload retain the idempotency key. Only a validated server deletion receipt replaces the source page, preventing further edits to a deleted source.

PM follow-up: confirmation now shows only the localized `Type "{slug}" to confirm` label and its input. The repeated slug/copy control and quotation helper were removed. The impact snapshot uses the shared `formatLocaleDateTimeWithYear()` utility to match other Admin timestamps, including locale, year and time. Browser coverage checks the simplified controls, formatted timestamp, quoted-value rejection and successful deletion receipt.

## Frame-to-route mapping

All frame IDs below belong to `eQOlQ9FcIGOOjlCqDZEQWd`. Existing routes are preserved; related prototype states are composed as dialogs/sections rather than introducing parallel routes.

| Figma Light / grayscale | Production route or state |
| --- | --- |
| 51: `1662:4431` / `1560:295` | `/admin/legal-sources/[sourceId]` |
| 108: `1968:14407` / `1970:40907` | `/admin/legal-source-versions/[versionId]` |
| 109: `1968:14509` / `1970:41190` | Documents section on the version route; existing provision inspector link |
| 110: `1968:14611` / `1970:41766` | Review activation dialog; technical checks and admission blocker |
| 111: `1968:14713` / `1970:42189` | Permanent deletion impact dialog on the source route |
| `1971:17259` / `1971:34065` | Create draft dialog; navigate to the server-assigned version |
| `1971:17396` / `1971:34211` | Eligible deletion, reason and exact source-slug confirmation |
| `1971:17533` / `1971:34357` | Server receipt result on the source route |
| `1970:15734` / `1970:41330` | File upload dialog |
| `1970:15872` / `1970:41476` | URL import dialog |
| `1970:16010` / `1970:41622` | Server submission acknowledgement and polled document statuses |

The ticket's `1971-17533l` URL has a trailing letter; the valid `1971:17533` frame was inspected. Canonical management row `1684:2613` and Field `1711:8138` were inspected before adapting the existing table rows and form fields. Figma's illustrative labels, documents and sample values are not production data.

## Master-to-code mapping

Paths below are relative to `apps/web/src/features/admin/components/`.

| Logical design component | Existing/new implementation |
| --- | --- |
| LegalSourceVersionDetail | `organisms/legal-source-version-page.tsx` |
| VersionList / management row | `organisms/legal-source-versions-table.tsx` |
| LegalDocumentTable / management row | `organisms/legal-source-document-table.tsx`, `molecules/legal-source-document-row.tsx` |
| DocumentUploadDialog, UrlImportDialog | `molecules/legal-source-document-dialog.tsx`, composed with existing upload/import form molecules |
| Field | Existing `legal-source-form-fields.tsx`, shadcn Input/Label, RHF context and feature Zod schemas |
| DocumentProcessingStatus | `molecules/legal-source-document-processing-status.tsx`, existing ingestion badge and retry mutation |
| ReadinessChecklist | `molecules/legal-source-readiness-checklist.tsx` |
| ActivationConfirmDialog | `molecules/legal-source-activation-dialog.tsx` |
| DeletionImpactPanel | `molecules/legal-source-deletion-impact-panel.tsx` |
| ConfirmDestructiveDialog | Existing `legal-source-delete-dialog.tsx`, `legal-source-confirm-dialog.tsx` |
| Deletion result / provenance | `molecules/legal-source-deletion-result.tsx`, `molecules/legal-source-document-provenance.tsx` |

New component props live in feature `types/legal-source-lifecycle.types.ts`; purpose options live in feature config. EN/VI lifecycle copy lives in `packages/i18n`. No page-specific branding or navigation replacement was introduced. The shared shell's pre-existing differences from Figma remain outside this follow-up.

## Confirmed contracts and backend gaps

Reviewed `packages/contracts/src/legal-source/{management,lifecycle}.ts`, the legal-source admin controller, management/document/deletion services, and existing BFF/query modules.

- Existing server contracts cover source/version identity and lineage, draft creation/discard, file bytes/import safety, per-document processing/retry, structural index status, final activation checks, deletion etags/blockers, reason, idempotency and durable receipts. Existing polling and backend authorization remain intact.
- Management responses **do not expose** admission to `lcsp-402-vn-cong-bao-v1`, Vietnamese jurisdiction verification, document number/issuing authority, fixed legal as-of date, or an LCSP-424/425 admission decision. Worker-owned official snapshot registration does not provide a document/version admission field in this UI contract. These facts are not inferred from a URL, corpus role, ingestion status or hash.
- The UI displays actual available source URL/hash/effective date, identities and provision-inspector links, with explicit missing-provenance notices. Activation submission is unavailable even when `canActivate` is technically true until an authoritative admission contract is implemented and reviewed. No admission field or client jurisdiction filter was invented.
- The create-version endpoint assigns the label; the illustrative editable version-label control was not added. The existing same-source base selection is used.
- No live API/database, admitted official corpus or durable audit store was available for this delivery. Actual persistence, server race/retention decisions, ingestion worker completion, activation, and deletion audit trails are **not verified** here. Do not mark the ticket implemented/accepted on the strength of UI fixtures. Resume those checks against a controlled real backend after LCSP-424/425 admission support exists.

Vietnamese law only: no normative text, legal requirement, foreign legal example, gold label or new official source was introduced. The new fixture is explicitly non-legal technical transport data. Browser/component results establish UI behavior only; they are excluded from legal accuracy and semantic-quality acceptance. Existing historical fixtures/diagnostics were not rewritten or promoted to legal evidence.

## Validation and walkthrough

- TypeScript builds: contracts, i18n, web and API.
- 17 focused component/BFF tests: lifecycle readiness guard, existing status/read-only behavior, upload/import failures, request forwarding, session/size checks and metadata.
- 3 Chromium browser flows: upload/import with purpose; activation refusal; source identity/provenance; responsive layout; deletion blockers and receipt; Vietnamese copy and keyboard opening/Escape/focus restoration.
- Mandatory business-documentation check and its 5 tests; contract-literal and import-policy checks.

Playwright MCP and Chrome DevTools MCP were not exposed in this session. Browser checks used the installed Playwright runner with real Chromium and page-error observation. Tests use intercepted API responses and the existing auth fixture, not a real lifecycle backend. Figma design contexts/screenshots were inspected via the Figma plugin; full Figma Presentation Mode walkthrough is not verified. `graphify-out/graph.json` was absent and `graphify`/`rtk` were unavailable in PATH.

Reproduce the browser walkthrough with `pnpm exec playwright test tests/e2e/admin/legal-source-lifecycle.spec.ts --workers=1`. Follow source → version → review activation → cancel → upload/import → inspect provenance. On source detail, inspect protected deletion blockers, refresh eligibility, enter reason and slug, then inspect the returned receipt. The browser tests exercise the latter eligible state only through explicit transport fixtures.

Evidence: [before](../implementation-artifacts/lcsp-418/before-version.png), [after](../implementation-artifacts/lcsp-418/after-version.png), [activation](../implementation-artifacts/lcsp-418/activation-blocked.png), [Vietnamese activation](../implementation-artifacts/lcsp-418/activation-vi.png), [upload](../implementation-artifacts/lcsp-418/upload.png), [mobile](../implementation-artifacts/lcsp-418/mobile.png), [deletion blockers](../implementation-artifacts/lcsp-418/deletion-blocked.png), [deletion receipt](../implementation-artifacts/lcsp-418/deletion-receipt.png). The before capture renders the base-commit page/row/add-document components with the same technical transport fixture, restored immediately afterward.
