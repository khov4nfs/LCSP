# LCSP Product Brief

## Status

AUTHORITATIVE PRODUCT BRIEF — PHASE 5.2L ACTIVE MVP

## Purpose

This brief defines the product intent, users, value proposition, scope boundaries and active MVP positioning for LCSP. Detailed requirements remain in `prd.md`, `business-rules.md`, and `docs/specs/`.

## Product Summary

LCSP is an evidence-based legal compliance support platform for businesses using AI in Vietnam. It helps a Manager create an assessment, provide business context, connect a repository, run a trusted scan, reconcile business and technical evidence, classify AI risk through direct EngineeringRule assessment with citation-backed legal provenance, generate compliance support documents, and preserve an audit trail.

LCSP is not a legal chatbot, formal legal opinion product, compliance certification product, direct regulator submission tool, or Wizard-only checklist.

## Target Users

| User | Active MVP responsibility |
|---|---|
| Manager | Owns the assessment, Wizard answers, repository connection, conflict resolution, classification request, report generation and audit export. |
| Developer | Optional scoped technical collaborator who may review redacted technical findings or support repository/evidence correction within PBAC policy. |
| Internal Legal Operator | Internal API/CLI actor who validates official legal sources, approves corpus versions and triggers legal index builds. No Manager/Developer UX screen is required for this actor in MVP. |

Manager is required and sufficient for the active MVP golden path. Developer absence must not block assessment completion.

## Active MVP Workflow

```text
Manager creates assessment
-> Manager completes WizardProfile
-> Manager connects repository
-> Automatic Trusted Scan Initiation creates or resumes Repository Scan
-> Python Scanner Worker produces TechnicalEvidenceReport
-> Python Worker Platform builds TechnicalProfile and AIUsageFlow
-> Manager resolves material conflicts when required
-> Direct EngineeringRule assessment compiles/investigates citation-backed legal rules
-> Risk classification and gap analysis run only after gates pass
-> Manager generates report and exports audit trail
```

## Product Principles

- PBAC is the authorization source of truth. Role labels are subject attributes/templates only.
- Risk classification requires evidence gates, direct EngineeringRule evaluations, legal citation traceability and unresolved-conflict checks.
- Wizard-only assessments may show readiness/preliminary indicators, but must not show HIGH/MEDIUM/LOW risk classification.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Manual technical evidence JSON upload (`FR-051`) is `REMOVED_FROM_PRODUCT`.
- Local/CI scanner report upload is superseded by `FR-050` Automatic Trusted Scan Initiation.
- All asynchronous domain workloads belong to the Python Worker Platform.
- Scanner output is evidence, not a legal conclusion.
- Legal retrieval is ChromaDB structure-first vectorless retrieval with legal hierarchy, effective-date filtering, parent/reference context assembly and citation allowlist validation.
- Raw source, secrets, full prompts and full AST bodies must not be sent to LLMs or stored in ordinary long-term records.

## In Scope

- Manager-led assessment workspace.
- WizardProfile, Repository Scan, TechnicalEvidenceReport, TechnicalProfile and AIUsageFlow.
- Evidence quality gates and conflict reconciliation.
- Manager-only final conflict resolution for MVP.
- Legal corpus ingestion from validated official-source snapshots.
- Direct EngineeringRule assessment with citation-backed LegalRule provenance.
- Risk classification, gap analysis, document generation and audit export after gates pass.
- Optional Developer task participation with scoped PBAC permissions.
- Real configured LLM provider for A-to-Z acceptance.

## Out of Scope

- Structured technical attestation as an active input.
- Manual evidence JSON upload.
- Local/CI scanner report upload as active or future product path.
- Compliance certification, formal legal opinion and direct regulator submission.
- Customer-facing legal corpus administration.
- Enterprise IAM administration, SAML/SCIM and multi-country compliance workflows.
- Implementation, CI/CD, deployment or production operations claims before readiness certification.

## Current Status

```text
PHASE_5_2L_ACTIVE_DOC_CONSOLIDATION_APPLIED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CANONICAL_EPICS_AND_STORIES_MISSING
IMPLEMENTATION_READINESS_NOT_CERTIFIED
IMPLEMENTATION_NOT_AUTHORIZED
```
