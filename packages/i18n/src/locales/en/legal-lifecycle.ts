export const enLegalLifecycle = {
  fileInvalid: "Choose a supported, non-empty file up to 25 MB.",
  versionDetail: "Legal Source Version Detail",
  versionDescription:
    "Manage draft and active versions without changing historical records.",
  draftManagement: "Draft management",
  draftNotice:
    "Draft changes do not alter the active source. Actions require current server eligibility.",
  reviewActivation: "Review activation",
  readiness: "Activation readiness",
  documentsCheck: "Required documents are present",
  processingCheck: "All documents have completed processing",
  indexCheck: "Structural index is valid",
  admissionCheck: "Official Vietnamese source admission",
  admissionMissing:
    "LCSP-424/425 admission is not exposed by this API. Activation is unavailable until the server confirms admission. Processing readiness does not establish legal validity.",
  passed: "Passed",
  blocked: "Blocked",
  refresh: "Refresh status",
  refreshing: "Refreshing status...",
  identity: "Source / version identity",
  activeVersion: "Current active version",
  basedOn: "Based on version",
  notRecorded: "Not provided by the server",
  purpose: "Document purpose",
  operative: "Primary legal text",
  reference: "Supporting reference only",
  purposeHelp:
    "Purpose controls corpus use, not legal admission. Only official Vietnamese legal documents may support normative requirements.",
  submitted:
    "Document accepted by the server. Processing and legal admission are separate checks.",
  attempt: "Processing attempt",
  hash: "Source SHA-256",
  documentIdentity: "Document identity",
  locatorHelp:
    "Inspect provisions for exact page/article/clause locators and original Vietnamese text.",
  officialProvenance: "Official source provenance",
  provenanceMissing:
    "Document number, issuing authority, fixed as-of date and legal admission are not available in the management API. Do not treat this document as verified legal authority.",
  impact: "Deletion impact",
  preflight:
    "Preview only. The server rechecks authorization, references, retention and this snapshot inside the deletion transaction.",
  snapshot: "Snapshot generated at",
  documents: "Documents",
  chunks: "Provisions",
  assessments: "Assessment references",
  ruleSets: "Rule-set versions",
  preparations: "Preparation runs",
  snapshots: "Preserved independent snapshots",
  auditPreserved: "Audit evidence is retained.",
  deleted: "Legal source deleted",
  receipt: "Deletion receipt",
  deletedAt: "Deleted at",
  returnToSources: "Return to legal sources",
  stale: "State may have changed. Refresh before continuing.",
  activationContext:
    "Existing assessments retain their pinned version. This action replaces the current active version only after server checks pass.",
  discardContext:
    "Only this eligible draft is discarded. Active and historical versions remain unchanged.",
  sourceId: "Source ID",
  versionId: "Version ID",
} as const;
