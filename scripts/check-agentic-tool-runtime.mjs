import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const tools = [
  {
    name: "resume_waiting_runs",
    handler: "apps/api/src/modules/legal-rule-catalog/application/commands/resume-waiting-runs/resume-waiting-runs.handler.ts",
    test: "apps/api/src/modules/legal-rule-catalog/application/commands/resume-waiting-runs/resume-waiting-runs.handler.spec.ts",
    module: "apps/api/src/modules/legal-rule-catalog/legal-rule-catalog.module.ts",
    registration: "ResumeWaitingRunsHandler",
    exposure: "apps/api/src/modules/legal-rule-catalog/presentation/http/legal-rule-catalog.controller.ts",
    exposureToken: "resumeWaitingRuns",
  },
  {
    name: "propose_gap_remediation",
    handler: "apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts",
    test: "apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts",
    module: "apps/api/src/modules/classification/classification.module.ts",
    registration: "ProposeGapRemediationHandler",
    exposure: "apps/api/src/modules/classification/presentation/http/gap-remediation.controller.ts",
    exposureToken: "proposeGapRemediation",
  },
  {
    name: "get_gap_evidence_trace",
    handler: "apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts",
    test: "apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts",
    module: "apps/api/src/modules/classification/classification.module.ts",
    registration: "GetGapEvidenceTraceHandler",
    exposure: "apps/api/src/modules/classification/presentation/http/gap-evidence-trace.controller.ts",
    exposureToken: "getGapEvidenceTrace",
  },
  {
    name: "get_reconciliation_context",
    handler: "apps/api/src/modules/reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.handler.ts",
    test: "apps/api/src/modules/reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.handler.spec.ts",
    module: "apps/api/src/modules/reconciliation/reconciliation.module.ts",
    registration: "GetReconciliationContextHandler",
    exposure: "apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts",
    exposureToken: "getReconciliationContext",
  },
  {
    name: "request_targeted_reanalysis",
    handler: "apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts",
    test: "apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts",
    module: "apps/api/src/modules/scan/scan.module.ts",
    registration: "RequestTargetedReanalysisHandler",
    exposure: "apps/api/src/modules/scan/presentation/http/scan.controller.ts",
    exposureToken: "requestTargetedReanalysis",
  },
  {
    name: "propose_missing_targets",
    handler: "apps/api/src/modules/reconciliation/application/queries/propose-missing-targets/propose-missing-targets.handler.ts",
    test: "apps/api/src/modules/reconciliation/application/queries/propose-missing-targets/propose-missing-targets.handler.spec.ts",
    module: "apps/api/src/modules/reconciliation/reconciliation.module.ts",
    registration: "ProposeMissingTargetsHandler",
    exposure: "apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts",
    exposureToken: "proposeMissingTargets",
  },
  ...[
    ["inspect_deployment_context", "inspect-deployment-context", "InspectDeploymentContextHandler", "inspectDeploymentContext"],
    ["inspect_decision_path", "inspect-decision-path", "InspectDecisionPathHandler", "inspectDecisionPath"],
    ["find_similar_symbols", "find-similar-symbols", "FindSimilarSymbolsHandler", "findSimilarSymbols"],
    ["inspect_human_review_path", "inspect-human-review-path", "InspectHumanReviewPathHandler", "inspectHumanReviewPath"],
    ["inspect_data_path", "inspect-data-path", "InspectDataPathHandler", "inspectDataPath"],
    ["find_provider_invocations", "find-provider-invocations", "FindProviderInvocationsHandler", "findProviderInvocations"],
    ["get_finding_detail", "get-finding-detail", "GetFindingDetailHandler", "getFindingDetail"],
    ["get_symbol_context", "get-symbol-context", "GetSymbolContextHandler", "getSymbolContext"],
    ["get_scan_coverage", "get-scan-coverage", "GetScanCoverageHandler", "getScanCoverage"],
    ["search_evidence", "search-evidence", "SearchEvidenceHandler", "searchEvidence"],
    ["get_evidence_subgraph", "get-evidence-subgraph", "GetEvidenceSubgraphHandler", "getEvidenceSubgraph"],
    ["trace_static_flow", "trace-static-flow", "TraceStaticFlowHandler", "traceStaticFlow"],
  ].map(([name, dir, registration, exposureToken]) => ({
    name,
    handler: `apps/api/src/modules/evidence/application/queries/${dir}/${dir}.handler.ts`,
    test: `apps/api/src/modules/evidence/application/queries/${dir}/${dir}.handler.spec.ts`,
    module: "apps/api/src/modules/evidence/evidence.module.ts",
    registration,
    exposure: "apps/api/src/modules/evidence/presentation/http/evidence.controller.ts",
    exposureToken,
  })),
  {
    name: "get_artifact_chain",
    handler: "apps/api/src/modules/reconciliation/application/queries/get-artifact-chain/get-artifact-chain.handler.ts",
    test: "apps/api/src/modules/reconciliation/application/queries/get-artifact-chain/get-artifact-chain.handler.spec.ts",
    module: "apps/api/src/modules/reconciliation/reconciliation.module.ts",
    registration: "GetArtifactChainHandler",
    exposure: "apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts",
    exposureToken: "getArtifactChain",
  },
];

const contractPath = resolve(root, "packages/contracts/src/evidence/agentic-tool.ts");
const contract = readFileSync(contractPath, "utf8");
const failures = [];

function readRequired(path, owner) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) {
    failures.push(`${owner}: missing ${path}`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

for (const tool of tools) {
  if (!contract.includes(`\"${tool.name}\"`)) {
    failures.push(`${tool.name}: not registered in canonical AGENTIC_TOOL_NAMES contract`);
  }

  const handler = readRequired(tool.handler, tool.name);
  if (handler && !handler.includes(tool.registration)) {
    failures.push(`${tool.name}: handler file does not define ${tool.registration}`);
  }

  readRequired(tool.test, tool.name);

  const module = readRequired(tool.module, tool.name);
  if (module && !module.includes(tool.registration)) {
    failures.push(`${tool.name}: ${tool.registration} is not registered in ${tool.module}`);
  }

  const exposure = readRequired(tool.exposure, tool.name);
  if (exposure && !exposure.includes(tool.exposureToken)) {
    failures.push(`${tool.name}: runtime exposure ${tool.exposureToken} missing from ${tool.exposure}`);
  }
}

const uniqueNames = new Set(tools.map((tool) => tool.name));
if (uniqueNames.size !== tools.length) {
  failures.push("tool inventory contains duplicate names");
}

if (failures.length > 0) {
  console.error("Sprint 6 agentic tool runtime integrity check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Sprint 6 agentic tool runtime integrity check passed for ${tools.length} tools.`);
