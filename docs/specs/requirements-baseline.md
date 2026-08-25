# Requirements Baseline

## Purpose

This document defines the active requirements baseline from existing active documents and historical traceability aliases. It does not create new requirements.

## Governance

- This document is authoritative for the recovered UC inventory, FR crosswalk, and NFR crosswalk.
- Canonical active FR namespace: `FR-001...` from `docs/specs/functional-requirements.md`.
- Canonical active NFR namespace: `NFR-001...` from `docs/specs/non-functional-requirements.md`.
- PRD `FR-E*` and `NFR-1..NFR-14` IDs are source aliases only. They are not active implementation requirement IDs after Phase 5.9 normalization.
- Legacy IDs remain traceability aliases recovered from historical requirement catalogs.
- Canonical FR inventory contains 56 total FRs. Phase 5.2L active MVP FRs are `FR-001..FR-044`, `FR-047..FR-050`, and `FR-053..FR-056`; `FR-045/FR-046` are `SUPERSEDED_FOR_ACTIVE_MVP`, `FR-051` is `REMOVED_FROM_PRODUCT`, and `FR-052` is `DEFERRED_POST_MVP`.
- Canonical active NFR inventory contains 33 active NFRs: `NFR-001..NFR-030` and `NFR-033..NFR-035`.
- `NFR-031` and `NFR-032` are legacy identifiers only, not active NFR catalog rows.
- `PLATFORM_BASELINE` means the active normalized requirement belongs to the platform baseline even when no one-to-one PRD source alias exists.
- Historical requirement catalogs remain non-authoritative and are not active source-of-truth documents.

## Active Canonical Sources

- `docs/product/prd.md`
- `docs/product/business-rules.md`

## Historical Recovery Inputs

Historical documents were used only to recover legacy IDs and traceability aliases. They remain available through git history and are not active implementation or requirements authority.

## PRD FR Source Alias Inventory

The following `FR-E*` identifiers are retained only as PRD/source aliases. Active implementation requirements use the `FR-001...` namespace in `docs/specs/functional-requirements.md`.

| PRD Source Alias | Name | Source |
| --- | --- | --- |
| FR-E1-1 | Create assessment | docs/product/prd.md |
| FR-E1-2 | Invite Developer | docs/product/prd.md |
| FR-E1-3 | Assign Developer policies | docs/product/prd.md |
| FR-E1-4 | Restrict Manager-only actions | docs/product/prd.md |
| FR-E2-1 | Capture WizardProfile | docs/product/prd.md |
| FR-E2-2 | Use business language | docs/product/prd.md |
| FR-E2-3 | Show readiness without risk level | docs/product/prd.md |
| FR-E2-4 | Set Wizard-only state | docs/product/prd.md |
| FR-E3-1 | GitHub App read-only evidence path | docs/product/prd.md |
| FR-E3-2 | Local/CI evidence upload | docs/product/prd.md |
| FR-E3-3 | Manual technical evidence JSON upload | docs/product/prd.md |
| FR-E3-4 | Privacy flags validation | docs/product/prd.md |
| FR-E3-5 | Superseded human technical attestation supplement | docs/product/prd.md |
| FR-E4-1 | Schema completeness gate | docs/product/prd.md |
| FR-E4-2 | Technical profile dimensions | docs/product/prd.md |
| FR-E4-3 | Quality threshold gate | docs/product/prd.md |
| FR-E4-4 | Context-aware threshold | docs/product/prd.md |
| FR-E5-1 | Compare WizardProfile and TechnicalProfile | docs/product/prd.md |
| FR-E5-2 | Generate Conflict Score | docs/product/prd.md |
| FR-E5-3 | Route technical conflicts to Manager | docs/product/prd.md |
| FR-E5-4 | Route business/legal conflicts to Manager | docs/product/prd.md |
| FR-E5-5 | Manager resolves MVP conflicts | docs/product/prd.md |
| FR-E5-6 | Block critical unresolved conflicts | docs/product/prd.md |
| FR-E6-1 | Create VerifiedProfile | docs/product/prd.md |
| FR-E6-2 | Lock classification until conditions pass | docs/product/prd.md |
| FR-E6-3 | Produce evidence-based risk output | docs/product/prd.md |
| FR-E6-4 | Degrade or block when legal rule/citation is missing | docs/product/prd.md |
| FR-E6-5 | Preserve rule precedence | docs/product/prd.md |
| FR-E7-1 | Generate gap analysis after risk result | docs/product/prd.md |
| FR-E7-2 | Generate compliance document/report | docs/product/prd.md |
| FR-E7-3 | Support readiness-only export | docs/product/prd.md |
| FR-E7-4 | Superseded attestation disclosure | docs/product/prd.md |
| FR-E8-1 | Audit Wizard answers | docs/product/prd.md |
| FR-E8-2 | Audit technical evidence metadata | docs/product/prd.md |
| FR-E8-3 | Audit conflict resolution | docs/product/prd.md |
| FR-E8-4 | Superseded human technical attestation audit | docs/product/prd.md |
| FR-E8-5 | Audit classification and generated documents | docs/product/prd.md |

### Deferred Evidence Source Aliases

| PRD Alias | Active Canonical Requirement | MVP Scope Status | Meaning |
| --- | --- | --- | --- |
| FR-E3-2 | FR-050 | SUPERSEDED_FOR_ACTIVE_MVP | Local/CI scanner report upload is superseded. `FR-050` now means Automatic Trusted Scan Initiation. |
| FR-E3-3 | FR-051 | REMOVED_FROM_PRODUCT | Manual technical evidence JSON upload is removed from active scope, roadmap, future scope, UX, APIs, entities, stories and delivery plans. |

The active controlled MVP technical-evidence path is GitHub App repository connection, snapshot creation and Repository Scan.

## PRD NFR Source Alias Inventory

The following PRD `NFR-*` identifiers are retained only as PRD/source aliases. Active implementation NFRs use the `NFR-001...` namespace in `docs/specs/non-functional-requirements.md`.

| Canonical NFR | Statement | Source |
| --- | --- | --- |
| NFR-1 | Raw source code must not be sent to LLM. | docs/product/prd.md |
| NFR-2 | Raw source code must not be stored long term. | docs/product/prd.md |
| NFR-3 | GitHub App access must be read-only and limited to selected repositories for MVP default path. | docs/product/prd.md |
| NFR-4 | Technical findings shown to Manager must avoid unnecessary source/code exposure. | docs/product/prd.md |
| NFR-5 | Secrets must be redacted before any evidence snippet or summary is stored. | docs/product/prd.md |
| NFR-6 | Risk classification must be repeatable for the same VerifiedProfile, legal corpus/rule version and evidence version. | docs/product/prd.md |
| NFR-7 | Every final report must be traceable to assessment, evidence, rules, conflict resolutions and document version. | docs/product/prd.md |
| NFR-8 | Legal corpus/rule version used for classification must be recorded. | docs/product/prd.md |
| NFR-9 | System must fail closed for missing critical evidence, missing legal trace or unresolved material conflict. | docs/product/prd.md |
| NFR-10 | Manager-facing language must avoid technical implementation terms unless accompanied by plain-language explanation. | docs/product/prd.md |
| NFR-11 | Developer-facing tasks must include enough assessment context to act without exposing unnecessary business data. | docs/product/prd.md |
| NFR-12 | Evidence statuses must be understandable to both Manager and Developer. | docs/product/prd.md |
| NFR-13 | MVP UI copy and documents should support Vietnamese as primary language. | docs/product/prd.md |
| NFR-14 | Web UI should target common accessibility expectations for forms, status messages and document review. | docs/product/prd.md |

## UC Inventory

| UC ID | Name | Actor | Status | Source |
| --- | --- | --- | --- | --- |
| UC-M01-01 | Register Account | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-02 | Login | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-04 | Setup MFA Using Authenticator App | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-05 | Verify MFA Code | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-06 | Disable MFA | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-07 | Reset MFA | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-08 | Manage Session | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-09 | Reset Password | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-10 | Login With MFA | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-11 | Verify Email | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-12 | Change Password | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-13 | Manage Personal Profile | Manager/Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M01-14 | Sign In with OAuth/OIDC | Manager/Developer, OAuth/OIDC Provider, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-01 | Create Organization | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-02 | Manage Organization Members | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-03 | Assign Manager Role | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-04 | Invite Developer | Manager, Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-05 | Assign Developer Policy | Manager, Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M02-06 | Revoke Developer Access | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M03-01 | Create Assessment | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M03-02 | Fill Web Wizard | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M03-03 | Save Wizard Progress | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M03-04 | Submit WizardProfile | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M03-05 | View Self-Declared Readiness | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M04-01 | Accept Developer Task | Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M04-02 | Connect GitHub Repository | Manager; optional delegated Developer; GitHub; LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M04-03 | Upload Local/CI Scanner Report | Developer, LCSP System | OUT_OF_SCOPE | active business-rules.md; archived traceability-matrix.md |
| UC-M04-04 | Upload Manual Technical Evidence JSON | Developer, LCSP System | OUT_OF_SCOPE | active business-rules.md; archived traceability-matrix.md |
| UC-M04-05 | Review Technical Findings | Manager; optional delegated Developer; LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M04-06 | Confirm Technical Truth | Developer, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M04-07 | Provide Structured Technical Attestation | Developer, LCSP System | SUPERSEDED_FOR_ACTIVE_MVP | historical decision record only |
| UC-M04-08 | Run Repository Scan | Manager; optional delegated Developer; LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M05-01 | Validate Evidence Schema | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M05-02 | Validate Privacy Flags | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M05-03 | Evaluate Evidence Quality | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M05-04 | Generate TechnicalProfile | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M05-05 | Mark Evidence as Rejected, Insufficient, or Ready | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-01 | Detect Conflict | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-02 | Calculate Conflict Score | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-03 | Route Conflict to Manager | LCSP System; Manager | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-04 | Resolve Technical Conflict | Manager; optional delegated Developer input; LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-05 | Resolve Business/Legal Conflict | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-06 | Post-MVP Delegated Technical Clarification | Manager, optional Developer, LCSP System | OUT_OF_SCOPE | active business-rules.md; archived use-case-specification.md |
| UC-M06-07 | Create VerifiedProfile | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M06-08 | Review and Approve VerifiedProfile | Manager, LCSP System | SUPERSEDED_FOR_ACTIVE_MVP | active flow removed VerifiedProfile approval gate |
| UC-M07-01 | Retrieve Legal Rules/Citations | LCSP System, Legal Corpus | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M07-02 | Run Risk Classification Agent | LCSP System, LLM Provider | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M07-03 | Trace Classification to Legal Rule | LCSP System, Legal Corpus | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M07-04 | Block or Degrade Classification if Citation Missing | LCSP System, Legal Corpus | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M08-01 | Run Gap Analysis Agent | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M08-02 | Generate Compliance Report | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M08-03 | Generate Readiness-Only Export | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M08-04 | View Document Status | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M08-06 | View Gap Analysis | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M09-01 | Write Audit Event | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M09-03 | Export Audit Trail | Manager, LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M09-04 | Track Evidence, Report, and Document Version | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M09-05 | Track Human Attestation Usage | LCSP System | SUPERSEDED_FOR_ACTIVE_MVP | historical decision record only |
| UC-M10-01 | Enforce Source Code Privacy Policy | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M10-02 | Redact Secrets | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M10-03 | Clean Temporary Workspace | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M10-04 | Enforce No Raw Source to LLM | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |
| UC-M10-05 | Enforce No Long-Term Raw Source Storage | LCSP System | ACTIVE | active business-rules.md; archived use-case-specification.md |

## Active FR to Source Alias Crosswalk

| Active FR | Name | PRD / Source Alias | Resolution | Source |
| --- | --- | --- | --- | --- |
| FR-001 | Register account | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-002 | Login | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-003 | Configure MFA | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-004 | Manage session and profile | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-005 | OAuth/OIDC login | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-006 | Separate OAuth and GitHub access | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-007 | Create organization | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-008 | Manage organization members | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-009 | Assign Manager role | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/functional-requirements.md` |
| FR-010 | Invite Developer | FR-E1-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-011 | Assign and revoke Developer policy | FR-E1-3, FR-E1-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-012 | Enforce Manager-only actions | FR-E1-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-013 | Create assessment | FR-E1-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-014 | Complete WizardProfile (recommended, not mandatory — AIUsageFlow/VerifiedProfile proceed as `TECHNICAL_ONLY` when skipped) | FR-E2-1, FR-E2-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-015 | Show readiness without risk level | FR-E2-3, FR-E2-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-016 | Connect GitHub repository | FR-E3-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-017 | Create repository snapshot | FR-E3-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-018 | Run repository scan | FR-E3-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-019 | Enforce scanner privacy | FR-E3-1, FR-E3-4, FR-E8-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-020 | Validate evidence schema and privacy flags | FR-E3-4, FR-E4-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-021 | Evaluate evidence quality | FR-E4-3, FR-E4-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-022 | Generate TechnicalProfile | FR-E4-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-023 | Detect AI usage signals | FR-E4-2, FR-E5-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-024 | Generate AIUsageFlow | FR-E4-2, FR-E5-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-025 | Mark unclear AI usage | FR-E4-3, FR-E6-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-026 | Compare profiles and detect conflict | FR-E5-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-027 | Calculate conflict score | FR-E5-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-028 | Route conflicts to Manager | FR-E5-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-029 | Resolve conflicts by Manager | FR-E5-3, FR-E5-4, FR-E5-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-030 | Create VerifiedProfile | FR-E6-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-031 | Remove VerifiedProfile approval gate | FR-E6-1, FR-E6-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-032 | Retrieve legal rules and citations | FR-E6-3, FR-E6-4, FR-E6-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-033 | Match legal rules by usage flow | FR-E6-3, FR-E6-4, FR-E6-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-034 | Block/degrade legal matching without citation | FR-E6-4 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-035 | Run risk classification | FR-E6-2, FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-036 | Produce evidence-based classification result | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-037 | View classification result | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-038 | Generate gap analysis | FR-E7-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-039 | Generate compliance report | FR-E7-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-040 | Generate readiness-only export | FR-E7-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-041 | View and download document status/artifact | FR-E7-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-042 | Write audit events | FR-E8-1, FR-E8-2, FR-E8-3, FR-E8-4, FR-E8-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-043 | View and export audit trail | FR-E8-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-044 | Track artifact versions | FR-E8-2, FR-E8-5 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-045 | Historical attestation usage | FR-E7-4, FR-E8-4 | SUPERSEDED_FOR_ACTIVE_MVP | `docs/specs/functional-requirements.md` |
| FR-046 | Historical structured technical attestation | FR-E3-5, FR-E8-4 | SUPERSEDED_FOR_ACTIVE_MVP | `docs/specs/functional-requirements.md` |
| FR-047 | Accept Developer task | FR-E1-2, FR-E1-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-048 | Review technical findings | FR-E3-1, FR-E4-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-049 | Re-run repository scan | FR-E3-1 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-050 | Automatic Trusted Scan Initiation | FR-E3-2 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-051 | Manual evidence JSON upload | FR-E3-3 | REMOVED_FROM_PRODUCT | `docs/specs/functional-requirements.md` |
| FR-052 | Support deferred delegated technical clarification | FR-E5-3, FR-E5-5 | DEFERRED | `docs/specs/functional-requirements.md` |
| FR-053 | Ingest legal sources | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-054 | Legal corpus review gate | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-055 | Configure LLM provider | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |
| FR-056 | Hybrid search | FR-E6-3 | CANONICAL_MAPPING | `docs/specs/functional-requirements.md` |

## Active NFR to Source Alias Crosswalk

| Active NFR | Name | PRD / Source Alias | Resolution | Source |
| --- | --- | --- | --- | --- |
| NFR-001 | Password, OAuth/OIDC and session authentication controls | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-002 | Session expiration, revocation and MFA/auth policy | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-003 | MFA secrets and OTP verification security | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-004 | Login, MFA and reset rate limiting | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-005 | OAuth/OIDC callback handling and safe account linking | PLATFORM_BASELINE; legacy NFR-031 | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-006 | OAuth/OIDC login separation from GitHub App authorization | NFR-3 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-007 | Read-only selected-repository GitHub App access | NFR-3 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-008 | Manager and Developer UI/API permission enforcement | NFR-9, NFR-11; legacy NFR-032 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-009 | Scoped and revocable Developer task/policy access | NFR-11 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-010 | Material workflow, auth, delegation, evidence, conflict, classification and document auditability | NFR-7 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-011 | Append-oriented audit trail with controlled correction model | NFR-7 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-012 | No raw source code to LLM provider | NFR-1 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-013 | No long-term raw source storage | NFR-2 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-014 | Redacted technical findings and minimal code exposure | NFR-3 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-015 | Secret redaction before logs, findings, reports, prompts or audit | NFR-5 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-016 | Accepted evidence provenance, version and integrity hash metadata | NFR-7 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-017 | Legal classification traceability to rule, citation and corpus version | NFR-7, NFR-8 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-018 | Fail-closed missing evidence, unresolved conflict, unknown critical usage or missing legal citation | NFR-8, NFR-9 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-019 | Evidence-backed VerifiedProfile and LegalRuleMatch classification basis | NFR-8, NFR-9 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-020 | Generated report overclaim prevention | NFR-9 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-021 | Async long-running workload reliability | NFR-6, NFR-9 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-022 | Actionable blocked/failed workflow states | NFR-12 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-023 | Bounded scan and worker operations | NFR-12 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-024 | API runtime and worker workload separation | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-025 | Domain module ownership of DTOs, tables, queues and state transitions | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-026 | Correlated evidence gate, queue, worker, classification and document failure observability | NFR-6 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-027 | Web form, status and document review accessibility | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md` |
| NFR-028 | Manager-facing Wizard and locked-state usability | NFR-10, NFR-12 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-029 | AIUsageFlow evidence refs and uncertainty reasons | NFR-7, NFR-8 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-030 | Historical evidence/profile/classification chain preservation on re-runs | NFR-7 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md` |
| NFR-033 | LLM API cost controls | PLATFORM_BASELINE | ACTIVE_CANONICAL | `docs/specs/non-functional-requirements.md`; ADR-024 |
| NFR-034 | Legal corpus immutability and approval | NFR-7, NFR-8 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md`; ADR-025 |
| NFR-035 | Python Worker sandbox isolation | NFR-1, NFR-2 | CANONICAL_MAPPING | `docs/specs/non-functional-requirements.md`; ADR-023 |

## Legacy NFR Alias Mapping

These identifiers are retained only for traceability drift cleanup. They are not active NFR inventory rows.

| Legacy Identifier | Active NFR | Meaning | Source |
| --- | --- | --- | --- |
| NFR-031 | NFR-005 | OAuth identity linking safety | archived non-functional-requirements.md; active PRD |
| NFR-032 | NFR-008 | Manager super-role enforcement | archived non-functional-requirements.md; active PRD |

## Acceptance Criteria Inventory

| AC | Statement | Source |
| --- | --- | --- |
| AC-1 | A Wizard-only assessment never displays HIGH/MEDIUM/LOW. A technical-only assessment may display a classification once evidence and EngineeringRule gates pass; business-declaration-dependent fields remain `UNKNOWN` when unsupported. | docs/product/prd.md |
| AC-2 | Risk Classification cannot run before direct EngineeringRule assessment has evidence refs and legal-rule provenance. | docs/product/prd.md |
| AC-3 | Technical evidence must pass schema completeness gate before reconciliation. | docs/product/prd.md |
| AC-4 | Technical evidence must pass quality threshold gate before classification unlock. | docs/product/prd.md |
| AC-5 | Any unresolved conflict blocks final classification/report until resolved. | docs/product/prd.md |
| AC-6 | Manager conflict resolution is required and sufficient for MVP conflict completion when evidence gates pass. | docs/product/prd.md |
| AC-7 | Evidence Confidence Score and AI Intervention Score never block workflow alone. | docs/product/prd.md |
| AC-8 | Conflict handling uses binary MVP routing: conflict exists or not. Conflict Score may explain seriousness but does not create multiple routes. | docs/product/prd.md |
| AC-9 | Human assertion, role label, delegated scope or untrusted upload cannot replace machine-generated metadata listed in A3. | docs/product/prd.md |
| AC-10 | Final report includes legal citation/rule trace or is not final. | docs/product/prd.md |
| AC-11 | Final report has no attestation dependency and discloses evidence, legal basis, PBAC/trigger trace and limitations. | docs/product/prd.md |
| AC-12 | Audit trail records wizard, evidence, conflict, PBAC/trigger, classification and document generation events. | docs/product/prd.md |
| AC-13 | PRD preserves all mandatory product decisions from Product Brief. | docs/product/prd.md |
| AC-14 | PRD contains section for high-risk assumptions and validation requirements. | docs/product/prd.md |
| AC-15 | PRD does not define architecture, backlog or code. | docs/product/prd.md |
| AC-16 | PRD is clear enough for Architect Agent to identify product constraints and unresolved assumptions. | docs/product/prd.md |

## Recovery Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Active canonical FR crosswalk matches `docs/specs/functional-requirements.md` | PASS | `FR-001..FR-056`; no active `FR-057..FR-082` rows remain in this crosswalk. |
| All active BR legacy NFR references listed | PASS | 29 unique legacy NFR refs recovered |
| Unmapped legacy FR IDs | PASS | None |
| Unmapped legacy NFR IDs | PASS | None |
| Platform-baseline FR IDs without one-to-one PRD source alias | RESOLVED_PLATFORM_BASELINE | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009 |
| Platform-baseline NFR IDs without one-to-one PRD source alias | RESOLVED_PLATFORM_BASELINE | NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-027, NFR-033 |

## Canonical Count Assertions

| Assertion | Value |
| --- | --- |
| Total canonical FRs | 56 |
| Active MVP FRs | 53 |
| Deferred FRs | 3 |
| Active NFRs | 33 |
| Legacy-only NFR identifiers | NFR-031, NFR-032 |

`FR-E*` values are source aliases only. `NFR-031` and `NFR-032` may appear only as legacy aliases/mappings and must not be counted as active NFR inventory.
