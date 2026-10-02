
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const fail = (message) => {
  console.error(`[engineering-rule-runtime] ${message}`);
  process.exitCode = 1;
};
const expectContains = (content, needle, label) => {
  if (!content.includes(needle)) fail(`${label} missing ${JSON.stringify(needle)}`);
};
const expectNotContains = (content, needle, label) => {
  if (content.includes(needle)) fail(`${label} must not contain ${JSON.stringify(needle)}`);
};
const expectMissing = (path, label) => {
  if (existsSync(join(ROOT, path))) fail(`${label} must be removed: ${path}`);
};

const pythonDispatcher = read(
  "deepagents/tools/common/capabilities/agentic_evidence/dispatch/dispatcher.py",
);
const remediationTools = read(
  "deepagents/tools/common/capabilities/agentic_evidence/entrypoints/remediation_tool_entrypoints.py",
);
const nestDispatcher = read(
  "apps/api/src/modules/evidence/presentation/http/agentic-tool-query-dispatcher.ts",
);
const internalCommandDispatcher = read(
  "apps/api/src/modules/evidence/presentation/http/agentic-tool-internal-dispatcher.ts",
);

expectMissing(
  "deepagents/tools/common/capabilities/agentic_evidence/entrypoints/program_graph_tool_entrypoints.py",
  "retired ProgramGraph entrypoints",
);
expectMissing(
  "deepagents/tools/common/capabilities/agentic_evidence/entrypoints/scanner_tool_entrypoints.py",
  "retired scanner entrypoints",
);

const retiredRepositoryGraphTools = [
  "inspect_deployment_context",
  "inspect_decision_path",
  "find_similar_symbols",
  "inspect_human_review_path",
  "inspect_data_path",
  "find_provider_invocations",
  "get_finding_detail",
  "get_symbol_context",
  "get_scan_coverage",
  "search_evidence",
  "get_evidence_subgraph",
  "trace_static_flow",
];
for (const tool of retiredRepositoryGraphTools) {
  expectNotContains(
    pythonDispatcher,
    `"${tool}", ToolRuntimeTarget.`,
    "Python runtime binding",
  );
}

expectContains(
  remediationTools,
  "def propose_gap_remediation(",
  "Python remediation entrypoints",
);
expectContains(
  pythonDispatcher,
  `"propose_gap_remediation", ToolRuntimeTarget.PYTHON_LOCAL`,
  "Python remediation binding",
);
expectContains(
  pythonDispatcher,
  "if self.entrypoint.__name__ != self.tool_name",
  "exact-name runtime invariant",
);
expectContains(
  pythonDispatcher,
  "canonical tool runtime bindings must be globally unique",
  "global uniqueness invariant",
);

const cqrsTools = [
  "get_artifact_chain",
  "get_reconciliation_context",
  "get_gap_evidence_trace",
  "get_gap_requirements",
  "evaluate_gap_matrix",
  "get_admin_source_catalog",
  "get_legal_corpus_readiness",
  "retrieve_legal_basis",
  "validate_citation_set",
];
for (const tool of cqrsTools) {
  expectContains(
    nestDispatcher,
    `export function ${tool}(`,
    "Nest CQRS dispatcher",
  );
  expectContains(
    pythonDispatcher,
    `"${tool}", ToolRuntimeTarget.NEST_CQRS`,
    "Nest CQRS runtime binding",
  );
}

const agentRuntimeCommandTools = [
  "resume_waiting_runs",
];
for (const tool of agentRuntimeCommandTools) {
  expectContains(
    internalCommandDispatcher,
    `export function ${tool}(`,
    "Agent Runtime command dispatcher",
  );
  expectContains(
    pythonDispatcher,
    `"${tool}", ToolRuntimeTarget.AGENT_RUNTIME_COMMAND`,
    "Agent Runtime command binding",
  );
}

const obsoleteNestQueries = [
  "find-provider-invocations",
  "find-similar-symbols",
  "get-evidence-subgraph",
  "get-finding-detail",
  "get-scan-coverage",
  "get-symbol-context",
  "inspect-data-path",
  "inspect-decision-path",
  "inspect-deployment-context",
  "inspect-human-review-path",
  "search-evidence",
  "trace-static-flow",
];
for (const directory of obsoleteNestQueries) {
  expectMissing(
    `apps/api/src/modules/evidence/application/queries/${directory}`,
    "obsolete Nest technical query",
  );
}

for (const tool of retiredRepositoryGraphTools) {
  if (nestDispatcher.includes(`export function ${tool}(`)) {
    fail(`retired repository graph tool ${tool} still has a Nest processing entrypoint`);
  }
}
if (nestDispatcher.includes("propose_gap_remediation")) {
  fail("propose_gap_remediation must be processed in Python, not Nest");
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  `[engineering-rule-runtime] OK: repository graph tools retired from custom runtime; 1 Python remediation tool, ${cqrsTools.length} Nest CQRS tools, ${agentRuntimeCommandTools.length} agent-runtime commands`,
);
