/**
 * V1 API routes that no longer exist after the W6 cutover. Each one answers HTTP 410 with the
 * standard problem envelope and the code below, so a straggler (old BFF, old worker, old pod) is
 * rejected and observable. W7 deletes the dead handler code behind them; this list is then the only
 * remaining trace and can be removed once no traffic has been seen for a full retention window.
 *
 * Paths use Express/Nest syntax without a leading slash.
 */
export const LEGACY_ROUTE_RETIRED_ERROR_CODE = "LEGACY_ROUTE_RETIRED";
export const LEGACY_ROUTE_RETIRED_STATUS = 410;

export const RETIRED_API_ROUTES = [
  // AI usage flow
  { method: "GET", path: "internal/ai-usage-flow/:aiUsageFlowId" },
  { method: "POST", path: "internal/ai-usage-flow/callback" },
  // Audit (interview trail)
  { method: "GET", path: "audit-events/assessments/:assessmentId/interview" },
  // Classification and gap analysis
  { method: "POST", path: "assessments/:assessmentId/classification/rerun" },
  { method: "POST", path: "internal/classification/result-callback" },
  { method: "POST", path: "assessments/:assessmentId/gap-evidence-trace" },
  { method: "POST", path: "assessments/:assessmentId/gap-matrix-evaluation" },
  { method: "POST", path: "assessments/:assessmentId/gap-requirements" },
  // Documents (V1 reports are served by the legacy archive instead)
  { method: "GET", path: "assessments/:assessmentId/documents" },
  {
    method: "GET",
    path: "assessments/:assessmentId/documents/:documentRequestId",
  },
  {
    method: "GET",
    path: "assessments/:assessmentId/documents/:documentRequestId/download",
  },
  { method: "POST", path: "assessments/:assessmentId/documents/final-report" },
  { method: "POST", path: "assessments/:assessmentId/documents/gap-analysis" },
  {
    method: "POST",
    path: "internal/document-requests/:documentRequestId/callback",
  },
  {
    method: "GET",
    path: "internal/document-requests/:documentRequestId/generation-context",
  },
  // Evidence (V1 pipeline reads and callbacks, agentic tool dispatcher)
  { method: "GET", path: "assessments/:assessmentId/artifacts" },
  {
    method: "GET",
    path: "assessments/:assessmentId/artifacts/business-context",
  },
  {
    method: "GET",
    path: "assessments/:assessmentId/artifacts/investigation-notes",
  },
  { method: "GET", path: "assessments/:assessmentId/evidence" },
  { method: "GET", path: "assessments/:assessmentId/evidence-graph" },
  { method: "GET", path: "assessments/:assessmentId/evidence-graph/overview" },
  { method: "POST", path: "internal/evidence/agentic-tools/dispatch" },
  { method: "GET", path: "internal/evidence/reports/:evidenceReportId" },
  { method: "POST", path: "internal/evidence/technical-profile-callback" },
  {
    method: "GET",
    path: "internal/evidence/technical-profiles/:technicalProfileId",
  },
  // GitHub (V1 scan trigger)
  { method: "POST", path: "assessments/:assessmentId/scan-jobs" },
  // Legal catalog (V1 classification support)
  { method: "GET", path: "assessments/:assessmentId/admin-source-catalog" },
  { method: "POST", path: "assessments/:assessmentId/citation-set-validation" },
  { method: "POST", path: "assessments/:assessmentId/legal-basis" },
  { method: "GET", path: "assessments/:assessmentId/legal-corpus-readiness" },
  {
    method: "POST",
    path: "internal/legal-rule-catalog/corpus/:versionId/resume-waiting-runs",
  },
  // Reconciliation
  { method: "POST", path: "internal/reconciliation/conflict-callback" },
  { method: "GET", path: "assessments/:assessmentId/artifact-chain" },
  { method: "GET", path: "assessments/:assessmentId/conflicts" },
  {
    method: "PATCH",
    path: "assessments/:assessmentId/conflicts/:conflictId/resolve",
  },
  { method: "GET", path: "assessments/:assessmentId/missing-targets" },
  { method: "GET", path: "assessments/:assessmentId/reconciliation-context" },
  // Scan, targeted reanalysis and decision model (`internal/scan-jobs/agent-stream-events` stays live)
  { method: "POST", path: "internal/scan-jobs/:scanJobId/callback" },
  { method: "POST", path: "internal/scan-jobs/:scanJobId/claim" },
  { method: "POST", path: "internal/scan-jobs/:scanJobId/runtime-events" },
  { method: "POST", path: "internal/scan-jobs/:scanJobId/terminal-failure" },
  {
    method: "POST",
    path: "internal/scan-jobs/decision-model/decisions/:decisionId/claim",
  },
  {
    method: "POST",
    path: "internal/scan-jobs/decision-model/decisions/:decisionId/complete",
  },
  { method: "POST", path: "internal/scan-jobs/decision-model/events" },
  { method: "POST", path: "internal/scan-jobs/targeted-reanalysis" },
  { method: "GET", path: "internal/targeted-reanalysis/:requestId" },
  { method: "POST", path: "internal/targeted-reanalysis/:requestId/claim" },
  { method: "POST", path: "internal/targeted-reanalysis/:requestId/requeue" },
  { method: "POST", path: "internal/targeted-reanalysis/:requestId/terminal" },
  { method: "GET", path: "assessments/:assessmentId/scan-jobs/:scanJobId" },
  { method: "POST", path: "assessments/:assessmentId/scan-jobs/rerun" },
  {
    method: "POST",
    path: "assessments/:assessmentId/scan-jobs/:scanJobId/evidence-reports/:evidenceReportId/targeted-reanalysis",
  },
  // Retired in W5 (controllers already unregistered); kept here so their callers are observable too
  { method: "POST", path: "internal/assessment-runtime-controls" },
  {
    method: "POST",
    path: "internal/assessment-interviews/:assessmentId/ai-not-detected",
  },
  { method: "GET", path: "internal/assessment-interviews/:assessmentId/state" },
  {
    method: "GET",
    path: "internal/assessment-interviews/:assessmentId/private-context/:contextRevision",
  },
  {
    method: "POST",
    path: "internal/assessment-interviews/:assessmentId/targeted-needs",
  },
  {
    method: "POST",
    path: "internal/assessment-interviews/:assessmentId/runtime-progress",
  },
  {
    method: "POST",
    path: "internal/assessment-interviews/:assessmentId/agent-decisions",
  },
  {
    method: "POST",
    path: "internal/assessment-interviews/:assessmentId/initial-question",
  },
  {
    method: "PUT",
    path: "internal/assessments/:assessmentId/rule-assessments/:engineeringRuleId",
  },
  {
    method: "GET",
    path: "internal/assessments/:assessmentId/rule-assessments",
  },
] as const;
