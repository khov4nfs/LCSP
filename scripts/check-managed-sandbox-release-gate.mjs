import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROOF_SCHEMA_VERSION = "LCSP333_MANAGED_SANDBOX_PROOF_V1";
export const EXEMPTION_SCHEMA_VERSION = "LCSP333_NON_SANDBOX_EXEMPTION_V1";
export const READINESS_GATE_CONTEXT = "Managed sandbox readiness gate";
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;

export const REQUIRED_STAGE_NAMES = [
  "PR_TRIGGER",
  "EXACT_HEAD_RESOLUTION",
  "CI_GATE",
  "GITHUB_MERGEABILITY",
  "MANAGED_SANDBOX_RUN",
  "SOURCE_CHECKOUT",
  "SCANNER",
  "PROGRAM_EVIDENCE_GRAPH",
  "TECHNICAL_COVERAGE",
  "INTERVIEW_BRANCH",
  "ENGINEERING_RULE_SELECTION",
  "ENGINEERING_RULE_EVALUATION",
  "PLANNER",
  "INVESTIGATOR",
  "RUNTIME_EVENT_PERSISTENCE",
  "WEB_SSE_OBSERVABILITY",
  "TERMINAL_VERDICT",
];

export const REQUIRED_CORRELATION_FIELDS = [
  "prNumber",
  "runId",
  "generation",
  "baseSha",
  "headSha",
  "assessmentId",
  "scannerRunId",
  "programEvidenceGraphId",
  "runtimeRunId",
];

export const REQUIRED_ARRAY_CORRELATION_FIELDS = [
  "agentRunIds",
  "engineeringRuleIds",
  "toolCallIds",
  "messageIds",
  "ciCheckRunIds",
  "runtimeEventIds",
];

export const REQUIRED_VISIBLE_EVENT_TYPES = [
  "AGENT_STARTED",
  "SCANNER_FILE",
  "SCANNER_SYMBOL",
  "SCANNER_DEPENDENCY",
  "SCANNER_TRACE_STEP",
  "ENGINEERING_RULE_CONTEXT",
  "PLANNER_DECISION",
  "INVESTIGATOR_RESULT",
  "SEMANTIC_TOOL_CALL",
  "SEMANTIC_TOOL_RESULT",
  "MODEL_REQUEST",
  "MODEL_RESULT",
  "GRAPH_UPDATE",
  "LOG",
  "AGENT_COMPLETED",
];

const TERMINAL_VERDICTS = new Set([
  "READY",
  "PASS",
  "NOT_READY",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);

const ACTIVE_STATES = new Set(["ACTIVE", "QUEUED", "RUNNING"]);
const TERMINAL_RUN_STATES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);
const SUPERSEDED_STATES = new Set(["SUPERSEDED", "CANCELLED"]);
const COMPLETED_STAGE_STATUSES = new Set([
  "COMPLETED",
  "OBSERVED",
  "GOVERNED_NO_INTERVIEW",
]);

const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:RSA |OPENSSH |EC |)PRIVATE KEY-----/u,
  /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[^"',\s}]{8,}/iu,
];

const SENSITIVE_KEYS = new Set([
  "systemPrompt",
  "developerPrompt",
  "hiddenReasoning",
  "hiddenChainOfThought",
  "chainOfThought",
  "privateContext",
  "rawSource",
  "sourceText",
  "credential",
  "secret",
  "apiKey",
  "password",
  "accessToken",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/iu.test(value);
}

function pathJoin(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

function pushRequiredObject(errors, value, label) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  return true;
}

function requireString(errors, object, key, label = key) {
  if (!isNonEmptyString(object?.[key])) {
    errors.push(`${label} is required`);
    return null;
  }
  return object[key].trim();
}

function requireSha(errors, object, key, label = key) {
  const value = object?.[key];
  if (!isSha(value)) {
    errors.push(`${label} must be a 40-character git SHA`);
    return null;
  }
  return value.toLowerCase();
}

function requireArray(errors, object, key, label = key) {
  const value = object?.[key];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return [];
  }
  return value;
}

function hasSecretLikeText(value) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function isRedactedString(value) {
  return /^(?:\[?REDACTED\]?|REDACTED_[A-Z_]+)$/u.test(value.trim());
}

function inspectPrivacy(value, errors, currentPath = "") {
  if (typeof value === "string") {
    if (hasSecretLikeText(value)) {
      errors.push(`${currentPath || "proof"} contains secret-like text`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectPrivacy(item, errors, `${currentPath}[${index}]`),
    );
    return;
  }
  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = pathJoin(currentPath, key);
    if (
      SENSITIVE_KEYS.has(key) &&
      child !== null &&
      child !== false &&
      child !== undefined
    ) {
      if (typeof child !== "string" || !isRedactedString(child)) {
        errors.push(`${childPath} must not contain raw sensitive material`);
      }
    }
    inspectPrivacy(child, errors, childPath);
  }
}

function stageByName(stages) {
  const map = new Map();
  for (const stage of stages) {
    if (isObject(stage) && isNonEmptyString(stage.name)) {
      map.set(stage.name, stage);
    }
  }
  return map;
}

function validateStages(proof, errors) {
  const stages = requireArray(errors, proof, "stages", "stages");
  const found = stageByName(stages);
  for (const name of REQUIRED_STAGE_NAMES) {
    const stage = found.get(name);
    if (!stage) {
      errors.push(`stages missing ${name}`);
      continue;
    }
    if (!COMPLETED_STAGE_STATUSES.has(stage.status)) {
      errors.push(`${name} status must be completed or governed`);
    }
    requireArray(errors, stage, "evidenceRefs", `${name}.evidenceRefs`);
  }

  const interviewStage = found.get("INTERVIEW_BRANCH");
  if (
    interviewStage &&
    !["INTERVIEW_REQUIRED", "NO_INTERVIEW_GOVERNED"].includes(
      interviewStage.branch,
    )
  ) {
    errors.push(
      "INTERVIEW_BRANCH.branch must declare INTERVIEW_REQUIRED or NO_INTERVIEW_GOVERNED",
    );
  }
}

function validateCanonicalRuns(proof, run, errors) {
  const canonicalRuns = requireArray(
    errors,
    proof,
    "canonicalRuns",
    "canonicalRuns",
  );
  const activeForHead = canonicalRuns.filter(
    (candidate) =>
      isObject(candidate) &&
      candidate.headSha === run.headSha &&
      candidate.generation === run.generation &&
      ACTIVE_STATES.has(candidate.state),
  );
  if (activeForHead.length > 1) {
    errors.push("only one canonical active run may exist for the current head");
  }
  const authoritativeCurrent = canonicalRuns.filter(
    (candidate) =>
      isObject(candidate) &&
      candidate.runId === run.runId &&
      candidate.headSha === run.headSha &&
      candidate.generation === run.generation &&
      candidate.authoritative === true,
  );
  if (authoritativeCurrent.length !== 1) {
    errors.push(
      "canonicalRuns must mark exactly one authoritative current run",
    );
  } else if (authoritativeCurrent[0].state !== run.status) {
    errors.push("authoritative canonical run state must match run.status");
  }

  for (const candidate of canonicalRuns) {
    if (!isObject(candidate)) continue;
    if (
      candidate.headSha !== run.headSha &&
      ACTIVE_STATES.has(candidate.state)
    ) {
      errors.push(
        `prior-head run ${candidate.runId ?? "<unknown>"} must not remain active`,
      );
    }
  }
}

function validateExactHead(proof, run, errors) {
  const exactHead = proof.exactHead;
  if (!pushRequiredObject(errors, exactHead, "exactHead")) return;
  const pinned = requireSha(
    errors,
    exactHead,
    "pinnedHeadSha",
    "exactHead.pinnedHeadSha",
  );
  const checkout = requireSha(
    errors,
    exactHead,
    "sandboxCheckoutSha",
    "exactHead.sandboxCheckoutSha",
  );
  const finalHead = requireSha(
    errors,
    exactHead,
    "finalHeadSha",
    "exactHead.finalHeadSha",
  );
  if (pinned && pinned !== run.headSha.toLowerCase()) {
    errors.push("exactHead.pinnedHeadSha must match run.headSha");
  }
  if (checkout && checkout !== run.headSha.toLowerCase()) {
    errors.push("sandbox checkout SHA must match pinned PR head");
  }
  if (finalHead && finalHead !== run.headSha.toLowerCase()) {
    if (["READY", "PASS"].includes(run.terminalVerdict)) {
      errors.push("READY/PASS verdict is forbidden when final PR head changed");
    }
    if (!SUPERSEDED_STATES.has(run.status)) {
      errors.push("head-changed run must be SUPERSEDED or CANCELLED");
    }
  }
  if (
    exactHead.headUnchanged !== true &&
    ["READY", "PASS"].includes(run.terminalVerdict)
  ) {
    errors.push("READY/PASS verdict requires exactHead.headUnchanged=true");
  }
}

function validateCiAndMergeability(proof, run, errors) {
  if (!pushRequiredObject(errors, proof.ci, "ci")) return;
  const ciHead = requireSha(errors, proof.ci, "headSha", "ci.headSha");
  if (ciHead && ciHead !== run.headSha.toLowerCase()) {
    errors.push("ci.headSha must match run.headSha");
  }
  const checks = requireArray(
    errors,
    proof.ci,
    "requiredChecks",
    "ci.requiredChecks",
  );
  for (const check of checks) {
    if (!isObject(check)) {
      errors.push("ci.requiredChecks entries must be objects");
      continue;
    }
    requireString(errors, check, "name", "ci.requiredChecks[].name");
    requireString(
      errors,
      check,
      "externalId",
      "ci.requiredChecks[].externalId",
    );
    if (check.status !== "COMPLETED") {
      errors.push(`${check.name ?? "check"} must be terminal`);
    }
    if (check.conclusion !== "SUCCESS") {
      errors.push(`${check.name ?? "check"} must have SUCCESS conclusion`);
    }
  }
  const pending = Array.isArray(proof.ci.pendingChecks)
    ? proof.ci.pendingChecks
    : [];
  if (pending.length > 0 && ["READY", "PASS"].includes(run.terminalVerdict)) {
    errors.push("READY/PASS verdict is forbidden while required CI is pending");
  }
  if (
    ["READY", "PASS"].includes(run.terminalVerdict) &&
    proof.ci.allRequiredTerminal !== true
  ) {
    errors.push("READY/PASS verdict requires all required checks terminal");
  }
  if (
    ["READY", "PASS"].includes(run.terminalVerdict) &&
    proof.ci.allRequiredPassed !== true
  ) {
    errors.push("READY/PASS verdict requires all required checks passed");
  }

  if (!pushRequiredObject(errors, proof.github, "github")) return;
  const githubHead = requireSha(
    errors,
    proof.github,
    "headSha",
    "github.headSha",
  );
  if (githubHead && githubHead !== run.headSha.toLowerCase()) {
    errors.push("github.headSha must match run.headSha");
  }
  if (!isNonEmptyString(proof.github.mergeState)) {
    errors.push("github.mergeState is required");
  }
  if (
    ["READY", "PASS"].includes(run.terminalVerdict) &&
    proof.github.mergeable !== true
  ) {
    errors.push("READY/PASS verdict requires github.mergeable=true");
  }
}

function validateSandbox(proof, run, errors) {
  if (!pushRequiredObject(errors, proof.managedSandbox, "managedSandbox")) {
    return;
  }
  if (proof.managedSandbox.productionEquivalent !== true) {
    errors.push("managedSandbox.productionEquivalent must be true");
  }
  if (!["MANAGED_SANDBOX", "VPS"].includes(proof.managedSandbox.hostKind)) {
    errors.push("managedSandbox.hostKind must be MANAGED_SANDBOX or VPS");
  }
  const checkout = requireSha(
    errors,
    proof.managedSandbox,
    "checkoutSha",
    "managedSandbox.checkoutSha",
  );
  if (checkout && checkout !== run.headSha.toLowerCase()) {
    errors.push("managedSandbox.checkoutSha must match run.headSha");
  }
  requireArray(
    errors,
    proof.managedSandbox,
    "artifactRefs",
    "managedSandbox.artifactRefs",
  );
  requireArray(
    errors,
    proof.managedSandbox,
    "logRefs",
    "managedSandbox.logRefs",
  );
}

function validateCorrelation(proof, run, errors) {
  if (!pushRequiredObject(errors, proof.correlation, "correlation")) return;
  for (const key of REQUIRED_CORRELATION_FIELDS) {
    if (key === "prNumber" || key === "generation") {
      if (!Number.isInteger(proof.correlation[key])) {
        errors.push(`correlation.${key} must be an integer`);
      }
      continue;
    }
    if (key.endsWith("Sha")) {
      requireSha(errors, proof.correlation, key, `correlation.${key}`);
      continue;
    }
    requireString(errors, proof.correlation, key, `correlation.${key}`);
  }
  for (const key of REQUIRED_ARRAY_CORRELATION_FIELDS) {
    requireArray(errors, proof.correlation, key, `correlation.${key}`);
  }
  if (proof.correlation.prNumber !== run.prNumber) {
    errors.push("correlation.prNumber must match run.prNumber");
  }
  if (proof.correlation.runId !== run.runId) {
    errors.push("correlation.runId must match run.runId");
  }
  if (proof.correlation.generation !== run.generation) {
    errors.push("correlation.generation must match run.generation");
  }
  if (
    isSha(proof.correlation.baseSha) &&
    proof.correlation.baseSha.toLowerCase() !== run.baseSha.toLowerCase()
  ) {
    errors.push("correlation.baseSha must match run.baseSha");
  }
  if (
    isSha(proof.correlation.headSha) &&
    proof.correlation.headSha.toLowerCase() !== run.headSha.toLowerCase()
  ) {
    errors.push("correlation.headSha must match run.headSha");
  }
}

function validateRuntime(proof, errors) {
  if (!pushRequiredObject(errors, proof.runtime, "runtime")) return;
  const eventTypes = requireArray(
    errors,
    proof.runtime,
    "persistedVisibleEventTypes",
    "runtime.persistedVisibleEventTypes",
  );
  for (const eventType of REQUIRED_VISIBLE_EVENT_TYPES) {
    if (!eventTypes.includes(eventType)) {
      errors.push(`runtime persisted event types missing ${eventType}`);
    }
  }
  if (proof.runtime.reconnectReplayProven !== true) {
    errors.push("runtime.reconnectReplayProven must be true");
  }
  if (proof.runtime.webSseObserved !== true) {
    errors.push("runtime.webSseObserved must be true");
  }
}

function validateRestartReconciliation(proof, run, errors) {
  if (
    !pushRequiredObject(
      errors,
      proof.restartReconciliation,
      "restartReconciliation",
    )
  ) {
    return;
  }
  if (proof.restartReconciliation.performed !== true) {
    errors.push("restartReconciliation.performed must be true");
  }
  const activeRunIds = Array.isArray(proof.restartReconciliation.activeRunIds)
    ? proof.restartReconciliation.activeRunIds
    : [];
  if (
    activeRunIds.filter((runId) => runId === run.runId).length !== 1 ||
    activeRunIds.length !== 1
  ) {
    errors.push(
      "restart reconciliation must leave exactly the current run active",
    );
  }
  const unresolved = (proof.restartReconciliation.orphanedRuns ?? []).filter(
    (candidate) =>
      isObject(candidate) &&
      ACTIVE_STATES.has(candidate.previousState) &&
      !SUPERSEDED_STATES.has(candidate.newState) &&
      candidate.newState !== "FAILED",
  );
  if (unresolved.length > 0) {
    errors.push("restart reconciliation left orphaned active runs unresolved");
  }
}

function validateScenarios(proof, errors) {
  if (!pushRequiredObject(errors, proof.scenarios, "scenarios")) return;
  const duplicate = proof.scenarios.duplicateRunPattern;
  if (!pushRequiredObject(errors, duplicate, "scenarios.duplicateRunPattern")) {
    return;
  }
  if (duplicate.prNumber !== 335) {
    errors.push("duplicate-run scenario must cover PR #335");
  }
  if (!SUPERSEDED_STATES.has(duplicate.staleRunState)) {
    errors.push("PR #335 stale run must be SUPERSEDED or CANCELLED");
  }
  if (duplicate.staleRunAuthoritative === true) {
    errors.push("PR #335 stale run must not be authoritative");
  }
  if (!isNonEmptyString(duplicate.canonicalRunId)) {
    errors.push("PR #335 canonical run id is required");
  }

  const green = proof.scenarios.greenExactHead;
  if (!pushRequiredObject(errors, green, "scenarios.greenExactHead")) return;
  if (green.prNumber !== 338) {
    errors.push("green exact-head scenario must cover PR #338");
  }
  if (
    green.codeReviewPassed !== true ||
    green.ciPassed !== true ||
    green.mergeable !== true ||
    !["READY", "PASS"].includes(green.verdict)
  ) {
    errors.push("PR #338 scenario must prove green exact-head readiness");
  }

  const pending = proof.scenarios.ciPendingCase;
  if (!pushRequiredObject(errors, pending, "scenarios.ciPendingCase")) return;
  if (pending.prNumber !== 336) {
    errors.push("CI-pending scenario must cover PR #336");
  }
  if (
    pending.codeReviewPassed !== true ||
    !Array.isArray(pending.pendingChecks) ||
    pending.pendingChecks.length === 0 ||
    ["READY", "PASS"].includes(pending.verdict)
  ) {
    errors.push(
      "PR #336 scenario must prove code PASS is not READY while CI runs",
    );
  }

  const cancellation = proof.scenarios.cancellation;
  if (!pushRequiredObject(errors, cancellation, "scenarios.cancellation")) {
    return;
  }
  if (cancellation.cancelledRunState !== "CANCELLED") {
    errors.push("cancellation scenario must cancel the selected run");
  }
  if (cancellation.cancelledRunId === cancellation.unrelatedRunId) {
    errors.push(
      "cancellation scenario must use distinct selected/unrelated runs",
    );
  }
  if (
    Array.isArray(cancellation.unrelatedRunStates) &&
    cancellation.unrelatedRunStates.includes("CANCELLED")
  ) {
    errors.push("cancellation scenario must not cancel unrelated runs");
  }
}

function validatePrivacy(proof, errors) {
  if (!pushRequiredObject(errors, proof.privacy, "privacy")) return;
  for (const key of [
    "sanitized",
    "secretScanPassed",
    "hiddenReasoningExcluded",
    "rawPromptExcluded",
    "privateContextExcluded",
    "unrestrictedSourceExcluded",
  ]) {
    if (proof.privacy[key] !== true) {
      errors.push(`privacy.${key} must be true`);
    }
  }
  inspectPrivacy(proof, errors);
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function requiredStatusChecks(ruleset) {
  return arrayValue(ruleset?.rules)
    .filter((rule) => rule?.type === "required_status_checks")
    .flatMap((rule) =>
      arrayValue(rule?.parameters?.required_status_checks),
    );
}

function requiredWorkflows(ruleset) {
  return arrayValue(ruleset?.rules)
    .filter((rule) => rule?.type === "workflows")
    .flatMap((rule) => arrayValue(rule?.parameters?.workflows));
}

function matchesTrustedWorkflow(workflow, trustedWorkflow) {
  if (workflow?.repository_id !== trustedWorkflow.repositoryId) return false;
  if (workflow?.path !== trustedWorkflow.path) return false;
  if (trustedWorkflow.ref && workflow?.ref !== trustedWorkflow.ref) return false;
  if (trustedWorkflow.sha && workflow?.sha !== trustedWorkflow.sha) return false;
  return Boolean(trustedWorkflow.ref || trustedWorkflow.sha);
}

export function validateManagedSandboxReleaseAuthority(
  ruleset,
  {
    trustedIntegrationIds = [],
    trustedWorkflowSources = [],
    readinessContext = READINESS_GATE_CONTEXT,
  } = {},
) {
  const errors = [];
  const warnings = [];
  if (!pushRequiredObject(errors, ruleset, "ruleset")) {
    return { ok: false, errors, warnings };
  }

  const trustedIntegrationIdSet = new Set(trustedIntegrationIds);
  if (trustedIntegrationIdSet.has(GITHUB_ACTIONS_INTEGRATION_ID)) {
    errors.push(
      "GitHub Actions must not be configured as the trusted managed-sandbox readiness integration",
    );
  }

  const readinessChecks = requiredStatusChecks(ruleset).filter(
    (check) => check?.context === readinessContext,
  );
  const trustedStatusChecks = readinessChecks.filter(
    (check) =>
      Number.isInteger(check.integration_id) &&
      check.integration_id !== GITHUB_ACTIONS_INTEGRATION_ID &&
      trustedIntegrationIdSet.has(check.integration_id),
  );

  for (const check of readinessChecks) {
    if (!Number.isInteger(check.integration_id)) {
      errors.push(
        `${readinessContext} is required by context name only; bind it to a trusted integration or remove the status check in favor of a protected required workflow`,
      );
      continue;
    }
    if (check.integration_id === GITHUB_ACTIONS_INTEGRATION_ID) {
      errors.push(
        `${readinessContext} must not trust the GitHub Actions integration because candidate PR workflows can emit same-named jobs`,
      );
      continue;
    }
    if (!trustedIntegrationIdSet.has(check.integration_id)) {
      errors.push(
        `${readinessContext} integration_id ${check.integration_id} is not in the trusted managed-sandbox publisher allow-list`,
      );
    }
  }

  const trustedWorkflowMatches = requiredWorkflows(ruleset).filter((workflow) =>
    trustedWorkflowSources.some((trustedWorkflow) =>
      matchesTrustedWorkflow(workflow, trustedWorkflow),
    ),
  );

  if (readinessChecks.length === 0 && trustedWorkflowMatches.length === 0) {
    errors.push(
      `${readinessContext} must be enforced by either a trusted integration-bound status check or a protected required workflow`,
    );
  }
  if (
    readinessChecks.length > 0 &&
    trustedStatusChecks.length === 0 &&
    trustedWorkflowMatches.length === 0
  ) {
    errors.push(
      `candidate-controlled workflows can satisfy ${readinessContext}; no trusted publisher or protected required workflow is enforced`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      readinessContext,
      trustedStatusCheckCount: trustedStatusChecks.length,
      trustedWorkflowCount: trustedWorkflowMatches.length,
    },
  };
}

export function validateManagedSandboxProof(proof) {
  const errors = [];
  const warnings = [];
  if (!pushRequiredObject(errors, proof, "proof")) {
    return { ok: false, errors, warnings };
  }
  if (proof.schemaVersion !== PROOF_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PROOF_SCHEMA_VERSION}`);
  }
  if (!pushRequiredObject(errors, proof.run, "run")) {
    return { ok: false, errors, warnings };
  }

  const run = proof.run;
  if (!Number.isInteger(run.prNumber)) errors.push("run.prNumber is required");
  requireString(errors, run, "runId", "run.runId");
  if (!Number.isInteger(run.generation)) {
    errors.push("run.generation must be an integer");
  }
  requireSha(errors, run, "baseSha", "run.baseSha");
  const headSha = requireSha(errors, run, "headSha", "run.headSha");
  requireString(errors, run, "triggerType", "run.triggerType");
  requireString(errors, run, "triggerId", "run.triggerId");
  if (!TERMINAL_VERDICTS.has(run.terminalVerdict)) {
    errors.push("run.terminalVerdict is invalid");
  }
  if (!TERMINAL_RUN_STATES.has(run.status)) {
    errors.push("run.status must be terminal");
  }
  if (
    ["READY", "PASS"].includes(run.terminalVerdict) &&
    run.status !== "COMPLETED"
  ) {
    errors.push("READY/PASS requires run.status=COMPLETED");
  }
  if (run.terminalVerdict === "SUPERSEDED" && run.status !== "SUPERSEDED") {
    errors.push("SUPERSEDED verdict requires run.status=SUPERSEDED");
  }
  if (run.terminalVerdict === "CANCELLED" && run.status !== "CANCELLED") {
    errors.push("CANCELLED verdict requires run.status=CANCELLED");
  }
  if (headSha) run.headSha = headSha;

  validateExactHead(proof, run, errors);
  validateCanonicalRuns(proof, run, errors);
  validateRestartReconciliation(proof, run, errors);
  validateSandbox(proof, run, errors);
  validateCiAndMergeability(proof, run, errors);
  validateStages(proof, errors);
  validateCorrelation(proof, run, errors);
  validateRuntime(proof, errors);
  validateScenarios(proof, errors);
  validatePrivacy(proof, errors);
  requireArray(errors, proof, "artifacts", "artifacts");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      prNumber: run.prNumber,
      runId: run.runId,
      generation: run.generation,
      headSha: run.headSha,
      verdict: run.terminalVerdict,
    },
  };
}

export function validateNonSandboxExemption(exemption, now = new Date()) {
  const errors = [];
  if (!pushRequiredObject(errors, exemption, "exemption")) {
    return { ok: false, errors, warnings: [] };
  }
  if (exemption.schemaVersion !== EXEMPTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${EXEMPTION_SCHEMA_VERSION}`);
  }
  for (const key of [
    "ticket",
    "approvedBy",
    "reason",
    "scope",
    "expiresAt",
    "riskAcceptance",
  ]) {
    requireString(errors, exemption, key, `exemption.${key}`);
  }
  if (exemption.scope === "RELEASE_READY") {
    errors.push("non-sandbox exemption cannot assert RELEASE_READY");
  }
  const expiresAt = Date.parse(exemption.expiresAt ?? "");
  if (!Number.isFinite(expiresAt)) {
    errors.push("exemption.expiresAt must be an ISO timestamp");
  } else if (expiresAt <= now.getTime()) {
    errors.push("non-sandbox exemption is expired");
  }
  inspectPrivacy(exemption, errors, "exemption");
  return {
    ok: errors.length === 0,
    errors,
    warnings: [
      "managed sandbox proof was not supplied; release readiness remains blocked unless this exemption is accepted by release governance",
    ],
    summary: {
      ticket: exemption.ticket,
      approvedBy: exemption.approvedBy,
      expiresAt: exemption.expiresAt,
      scope: exemption.scope,
    },
  };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const result = {
    proof: process.env.LCSP333_MANAGED_SANDBOX_PROOF ?? null,
    exemption: process.env.LCSP333_NON_SANDBOX_EXEMPTION ?? null,
    out: process.env.LCSP333_MANAGED_SANDBOX_GATE_OUT ?? null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--proof") result.proof = argv[++index] ?? null;
    else if (arg === "--exemption") result.exemption = argv[++index] ?? null;
    else if (arg === "--out") result.out = argv[++index] ?? null;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return [
    "Usage:",
    "  pnpm run check:managed-sandbox-release-gate -- --proof <proof.json> [--out <result.json>]",
    "  pnpm run check:managed-sandbox-release-gate -- --exemption <exemption.json> [--out <result.json>]",
    "",
    "Environment alternatives:",
    "  LCSP333_MANAGED_SANDBOX_PROOF=<proof.json>",
    "  LCSP333_NON_SANDBOX_EXEMPTION=<exemption.json>",
    "  LCSP333_MANAGED_SANDBOX_GATE_OUT=<result.json>",
  ].join("\n");
}

async function writeOutcome(filePath, outcome) {
  if (!filePath) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.proof && !args.exemption) {
    console.error("[lcsp-333] managed sandbox proof or exemption is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (args.proof && args.exemption) {
    console.error("[lcsp-333] choose either --proof or --exemption, not both");
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(args.proof ?? args.exemption);
  const input = await readJson(inputPath);
  const outcome = args.proof
    ? validateManagedSandboxProof(input)
    : validateNonSandboxExemption(input);
  outcome.mode = args.proof ? "PROOF" : "EXEMPTION";
  outcome.inputPath = inputPath;

  await writeOutcome(args.out, outcome);

  if (!outcome.ok) {
    console.error("[lcsp-333] managed sandbox gate failed");
    for (const error of outcome.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  for (const warning of outcome.warnings ?? []) {
    console.warn(`[lcsp-333] warning: ${warning}`);
  }
  console.log(
    `[lcsp-333] managed sandbox gate passed (${outcome.mode}): ${JSON.stringify(
      outcome.summary,
    )}`,
  );
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCli) {
  main().catch((error) => {
    console.error(
      `[lcsp-333] managed sandbox gate crashed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
