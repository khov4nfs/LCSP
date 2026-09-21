import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  EXEMPTION_SCHEMA_VERSION,
  PROOF_SCHEMA_VERSION,
  REQUIRED_STAGE_NAMES,
  REQUIRED_VISIBLE_EVENT_TYPES,
  validateManagedSandboxReleaseAuthority,
  validateManagedSandboxProof,
  validateNonSandboxExemption,
} from "./check-managed-sandbox-release-gate.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const priorSha = "c".repeat(40);
const trustedIntegrationId = 987654;
const githubActionsIntegrationId = 15368;
const repositoryId = 1271744875;
const trustedWorkflowSource = {
  repositoryId,
  path: ".github/workflows/managed-sandbox-readiness-gate.yml",
  ref: "refs/heads/lcsp-governance/managed-sandbox-readiness-gate",
};

function completeStages() {
  return REQUIRED_STAGE_NAMES.map((name) => ({
    name,
    status: name === "INTERVIEW_BRANCH" ? "GOVERNED_NO_INTERVIEW" : "COMPLETED",
    branch: name === "INTERVIEW_BRANCH" ? "NO_INTERVIEW_GOVERNED" : undefined,
    evidenceRefs: [`evidence:${name.toLowerCase()}`],
  }));
}

function validProof(overrides = {}) {
  return {
    schemaVersion: PROOF_SCHEMA_VERSION,
    run: {
      prNumber: 338,
      runId: "review-run-338-1",
      generation: 1,
      baseSha,
      headSha,
      triggerType: "webhook:synchronize",
      triggerId: "delivery-338",
      status: "COMPLETED",
      terminalVerdict: "READY",
    },
    exactHead: {
      pinnedHeadSha: headSha,
      sandboxCheckoutSha: headSha,
      finalHeadSha: headSha,
      headUnchanged: true,
    },
    canonicalRuns: [
      {
        runId: "review-run-338-1",
        generation: 1,
        headSha,
        state: "COMPLETED",
        authoritative: true,
      },
      {
        runId: "review-run-338-old",
        generation: 0,
        headSha: priorSha,
        state: "SUPERSEDED",
        authoritative: false,
        reason: "HEAD_CHANGED",
      },
    ],
    restartReconciliation: {
      performed: true,
      activeRunIds: ["review-run-338-1"],
      orphanedRuns: [
        {
          runId: "review-run-335-opened",
          previousState: "RUNNING",
          newState: "SUPERSEDED",
          reason: "PM2_RESTART_ORPHANED_PRIOR_HEAD",
        },
      ],
    },
    managedSandbox: {
      hostKind: "MANAGED_SANDBOX",
      productionEquivalent: true,
      checkoutSha: headSha,
      artifactRefs: ["artifact:sandbox-log"],
      logRefs: ["log:sanitized-sandbox"],
    },
    ci: {
      headSha,
      allRequiredTerminal: true,
      allRequiredPassed: true,
      requiredChecks: [
        {
          name: "API e2e tests",
          externalId: "check-run:api-e2e",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
      ],
      pendingChecks: [],
    },
    github: {
      headSha,
      mergeable: true,
      mergeState: "MERGEABLE",
      branchState: "CURRENT",
    },
    stages: completeStages(),
    correlation: {
      prNumber: 338,
      runId: "review-run-338-1",
      generation: 1,
      baseSha,
      headSha,
      assessmentId: "assessment-338",
      scannerRunId: "scanner-338",
      programEvidenceGraphId: "pge-338",
      runtimeRunId: "runtime-338",
      agentRunIds: ["agent-planner-338", "agent-investigator-338"],
      engineeringRuleIds: ["ENG-HUMAN-OVERSIGHT"],
      toolCallIds: ["tool-call-338"],
      messageIds: ["message-338"],
      ciCheckRunIds: ["check-run:api-e2e"],
      runtimeEventIds: ["runtime-event-338"],
    },
    runtime: {
      persistedVisibleEventTypes: [...REQUIRED_VISIBLE_EVENT_TYPES],
      reconnectReplayProven: true,
      webSseObserved: true,
    },
    scenarios: {
      duplicateRunPattern: {
        prNumber: 335,
        staleRunState: "SUPERSEDED",
        staleRunAuthoritative: false,
        canonicalRunId: "review-run-335-synchronize",
      },
      greenExactHead: {
        prNumber: 338,
        codeReviewPassed: true,
        ciPassed: true,
        mergeable: true,
        verdict: "READY",
      },
      ciPendingCase: {
        prNumber: 336,
        codeReviewPassed: true,
        pendingChecks: ["API e2e tests"],
        verdict: "NOT_READY",
      },
      cancellation: {
        cancelledRunId: "review-run-cancelled",
        cancelledRunState: "CANCELLED",
        unrelatedRunId: "review-run-other",
        unrelatedRunStates: ["RUNNING"],
      },
    },
    privacy: {
      sanitized: true,
      secretScanPassed: true,
      hiddenReasoningExcluded: true,
      rawPromptExcluded: true,
      privateContextExcluded: true,
      unrestrictedSourceExcluded: true,
    },
    artifacts: ["artifact:machine-readable-proof"],
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function expectInvalid(proof, pattern) {
  const result = validateManagedSandboxProof(proof);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), pattern);
}

function rulesetWithManagedSandboxStatus(check) {
  return {
    id: 18478777,
    name: "develop",
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            { context: "Require Jira issue key" },
            {
              context: "Managed sandbox readiness gate",
              ...check,
            },
          ],
          strict_required_status_checks_policy: true,
        },
      },
    ],
  };
}

function rulesetWithTrustedWorkflow(workflow = {}) {
  return {
    id: 18478777,
    name: "develop",
    rules: [
      {
        type: "workflows",
        parameters: {
          workflows: [
            {
              repository_id: repositoryId,
              path: trustedWorkflowSource.path,
              ref: trustedWorkflowSource.ref,
              ...workflow,
            },
          ],
        },
      },
    ],
  };
}

test("rejects a context-only managed-sandbox readiness status check", () => {
  const result = validateManagedSandboxReleaseAuthority(
    rulesetWithManagedSandboxStatus({}),
    { trustedIntegrationIds: [trustedIntegrationId] },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /context name only/u);
  assert.match(
    result.errors.join("\n"),
    /candidate-controlled workflows can satisfy/u,
  );
});

test("rejects GitHub Actions as the authoritative managed-sandbox readiness publisher", () => {
  const result = validateManagedSandboxReleaseAuthority(
    rulesetWithManagedSandboxStatus({
      integration_id: githubActionsIntegrationId,
    }),
    { trustedIntegrationIds: [githubActionsIntegrationId] },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /GitHub Actions must not/u);
  assert.match(result.errors.join("\n"), /same-named jobs/u);
});

test("accepts a trusted app-bound managed-sandbox readiness status check", () => {
  const result = validateManagedSandboxReleaseAuthority(
    rulesetWithManagedSandboxStatus({
      integration_id: trustedIntegrationId,
    }),
    { trustedIntegrationIds: [trustedIntegrationId] },
  );

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.trustedStatusCheckCount, 1);
});

test("accepts a protected required workflow as the managed-sandbox release authority", () => {
  const result = validateManagedSandboxReleaseAuthority(
    rulesetWithTrustedWorkflow(),
    { trustedWorkflowSources: [trustedWorkflowSource] },
  );

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.summary.trustedWorkflowCount, 1);
});

test("rejects a required workflow source that is not pinned to an approved protected ref or SHA", () => {
  const result = validateManagedSandboxReleaseAuthority(
    rulesetWithTrustedWorkflow({
      ref: "refs/heads/feature/candidate-controlled-readiness",
    }),
    { trustedWorkflowSources: [trustedWorkflowSource] },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /protected required workflow/u);
});

test("accepts a complete managed-sandbox proof for the green exact-head case", () => {
  const result = validateManagedSandboxProof(validProof());

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    prNumber: 338,
    runId: "review-run-338-1",
    generation: 1,
    headSha,
    verdict: "READY",
  });
});

test("enforces terminal run lifecycle and canonical state consistency", () => {
  for (const status of ["RUNNING", "QUEUED"]) {
    const proof = clone(validProof());
    proof.run.status = status;
    proof.canonicalRuns[0].state = status;
    expectInvalid(
      proof,
      /run\.status must be terminal[\s\S]*READY\/PASS requires run\.status=COMPLETED/u,
    );
  }

  const completed = clone(validProof());
  assert.equal(validateManagedSandboxProof(completed).ok, true);

  const superseded = clone(validProof());
  superseded.run.status = "SUPERSEDED";
  superseded.run.terminalVerdict = "SUPERSEDED";
  superseded.canonicalRuns[0].state = "SUPERSEDED";
  assert.equal(validateManagedSandboxProof(superseded).ok, true);

  const cancelled = clone(validProof());
  cancelled.run.status = "CANCELLED";
  cancelled.run.terminalVerdict = "CANCELLED";
  cancelled.canonicalRuns[0].state = "CANCELLED";
  assert.equal(validateManagedSandboxProof(cancelled).ok, true);

  const mismatch = clone(validProof());
  mismatch.canonicalRuns[0].state = "FAILED";
  expectInvalid(
    mismatch,
    /authoritative canonical run state must match run\.status/u,
  );
});

test("rejects READY verdicts when the PR head changes before final verdict", () => {
  const proof = clone(validProof());
  proof.exactHead.finalHeadSha = priorSha;
  proof.exactHead.headUnchanged = false;

  expectInvalid(
    proof,
    /READY\/PASS verdict is forbidden when final PR head changed/u,
  );
});

test("rejects duplicate authoritative active runs for the same current head", () => {
  const proof = clone(validProof());
  proof.canonicalRuns.push({
    runId: "review-run-338-duplicate",
    generation: 1,
    headSha,
    state: "RUNNING",
    authoritative: true,
  });
  proof.canonicalRuns[0].state = "RUNNING";

  expectInvalid(proof, /only one canonical active run/u);
});

test("rejects stale prior-head runs that remain active after synchronize", () => {
  const proof = clone(validProof());
  proof.canonicalRuns.push({
    runId: "review-run-338-prior-active",
    generation: 0,
    headSha: priorSha,
    state: "RUNNING",
    authoritative: false,
  });

  expectInvalid(proof, /prior-head run review-run-338-prior-active/u);
});

test("rejects correlation identity from another generation or exact head", () => {
  const generationMismatch = clone(validProof());
  generationMismatch.correlation.generation = 2;
  expectInvalid(
    generationMismatch,
    /correlation\.generation must match run\.generation/u,
  );

  const baseMismatch = clone(validProof());
  baseMismatch.correlation.baseSha = priorSha;
  expectInvalid(baseMismatch, /correlation\.baseSha must match run\.baseSha/u);

  const headMismatch = clone(validProof());
  headMismatch.correlation.headSha = priorSha;
  expectInvalid(headMismatch, /correlation\.headSha must match run\.headSha/u);
});

test("accepts correlation identity only when it matches the canonical run", () => {
  const proof = validProof();
  const result = validateManagedSandboxProof(proof);

  assert.equal(result.ok, true);
  assert.equal(proof.correlation.generation, proof.run.generation);
  assert.equal(proof.correlation.baseSha, proof.run.baseSha);
  assert.equal(proof.correlation.headSha, proof.run.headSha);
});

test("rejects code-review PASS as READY while required CI is still pending", () => {
  const proof = clone(validProof());
  proof.ci.allRequiredTerminal = false;
  proof.ci.allRequiredPassed = false;
  proof.ci.pendingChecks = ["API e2e tests"];

  expectInvalid(
    proof,
    /READY\/PASS verdict is forbidden while required CI is pending/u,
  );
});

test("rejects missing pipeline stages and runtime event classes", () => {
  const proof = clone(validProof());
  proof.stages = proof.stages.filter((stage) => stage.name !== "PLANNER");
  proof.runtime.persistedVisibleEventTypes =
    proof.runtime.persistedVisibleEventTypes.filter(
      (eventType) => eventType !== "MODEL_RESULT",
    );

  expectInvalid(
    proof,
    /stages missing PLANNER[\s\S]*runtime persisted event types missing MODEL_RESULT/u,
  );
});

test("rejects raw prompts, hidden reasoning, source and secret-like text", () => {
  const proof = clone(validProof());
  proof.privacy.systemPrompt = "You are the hidden system prompt";
  proof.privacy.hiddenReasoning = "private deliberation";
  proof.privacy.note = "api_key=ghp_123456789012345678901234567890123456";

  expectInvalid(
    proof,
    /privacy\.systemPrompt[\s\S]*privacy\.hiddenReasoning[\s\S]*secret-like/u,
  );
});

test("rejects selected-run cancellation that also cancels unrelated runs", () => {
  const proof = clone(validProof());
  proof.scenarios.cancellation.unrelatedRunStates = ["CANCELLED"];

  expectInvalid(proof, /must not cancel unrelated runs/u);
});

test("accepts an explicit non-sandbox exemption without marking release ready", () => {
  const result = validateNonSandboxExemption(
    {
      schemaVersion: EXEMPTION_SCHEMA_VERSION,
      ticket: "LCSP-333",
      approvedBy: "release-owner",
      reason:
        "Managed VPS unavailable; release remains blocked pending acceptance.",
      scope: "DIAGNOSTIC_ONLY",
      expiresAt: "2099-01-01T00:00:00.000Z",
      riskAcceptance: "Temporary non-ready exemption for evidence collection.",
    },
    new Date("2026-09-21T00:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.summary.scope, "DIAGNOSTIC_ONLY");
  assert.equal(result.warnings.length, 1);
});

test("rejects expired or release-ready non-sandbox exemptions", () => {
  const result = validateNonSandboxExemption(
    {
      schemaVersion: EXEMPTION_SCHEMA_VERSION,
      ticket: "LCSP-333",
      approvedBy: "release-owner",
      reason: "Expired exemption",
      scope: "RELEASE_READY",
      expiresAt: "2026-01-01T00:00:00.000Z",
      riskAcceptance: "Expired",
    },
    new Date("2026-09-21T00:00:00.000Z"),
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cannot assert RELEASE_READY/u);
  assert.match(result.errors.join("\n"), /expired/u);
});

test("CLI validates proof and writes a machine-readable outcome artifact", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lcsp333-managed-sandbox-gate-"),
  );
  const proofPath = path.join(directory, "proof.json");
  const outPath = path.join(directory, "outcome.json");
  await writeFile(proofPath, `${JSON.stringify(validProof(), null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      "scripts/check-managed-sandbox-release-gate.mjs",
      "--proof",
      proofPath,
      "--out",
      outPath,
    ],
    {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.mode, "PROOF");
});
