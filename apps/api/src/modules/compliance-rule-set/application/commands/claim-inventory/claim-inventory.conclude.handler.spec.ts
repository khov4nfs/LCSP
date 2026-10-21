import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import {
  AgentExecutionState,
  ClaimPreparationPhase,
  RuleSetPreparationFailureReason,
  SourceReviewState,
} from "@prisma/client";
import {
  CLAIM_INVENTORY_ACTIONS as A,
  CLAIM_INVENTORY_GAPS as G,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  CLAIM_PREPARATION_PHASES as P,
  RULE_SET_PREPARATION_FAILURE_REASONS as REASONS,
  claimInventoryOperationSchema,
  ruleSetPreparationFailRequestSchema,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../../../test/support/compliance-rule-set-fixtures.js";
import { canonicalInventoryFixture } from "../../../../../../test/support/canonical-claim-inventory-fixture.js";
import { refreshStructuralAudits } from "../../../../../../test/support/structural-semantic-fixture.js";
import { signSemanticAuditFixture } from "../../../domain/semantic-audit-attestation.js";
import {
  inventoryFingerprint,
  inventoryHash,
  normalizeInventory,
} from "../../../domain/claim-inventory.js";
import { reviewedFrontierFingerprint } from "../../../domain/source-review-frontier.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { LegalSourceSnapshotLoader } from "../../../infrastructure/persistence/legal-source-snapshot.service.js";
import { ClaimInventoryHandler } from "./claim-inventory.handler.js";
import { ClaimInventoryCommand } from "./claim-inventory.command.js";

const RUN = "00000000-0000-4000-8000-000000000009";
const FRONTIER = "f".repeat(64);

/** A completed, independently audited review whose inventory states no duty (one definition may remain). */
function persisted({ duty = false, unreviewed = false, audit = "ok" } = {}) {
  const source = fixtureLegalSource();
  const base = canonicalInventoryFixture(
    validPacket(),
    RUN,
    1,
    source.documentGraph!,
  );
  const graph = base.graph;
  const keep = new Set(
    graph.claims
      .filter((c) =>
        duty
          ? c.claimType === "DUTY" || c.claimType === "DEFINITION"
          : c.claimType === "DEFINITION",
      )
      .map((c) => c.claimId),
  );
  graph.claims = graph.claims.filter((c) => keep.has(c.claimId));
  graph.relations = graph.relations.filter(
    (r) => keep.has(r.fromClaimId) && keep.has(r.toClaimId),
  );
  graph.sourceAccounting = graph.sourceAccounting.map((r) => {
    const claimIds = r.claimIds.filter((id) => keep.has(id));
    return {
      ...r,
      claimIds,
      nonSemanticReason: claimIds.length ? null : "States no semantic material",
    };
  });
  const identities = Object.fromEntries(
    Object.entries(base.identities).filter(([id]) => keep.has(id)),
  );
  refreshStructuralAudits(graph, source.documentGraph!, 1);
  graph.semanticAudits = graph.semanticAudits!.map((receipt) =>
    signSemanticAuditFixture(receipt, RUN),
  );
  if (audit === "missing") graph.semanticAudits.pop();
  if (audit === "failed") {
    graph.semanticAudits[0] = signSemanticAuditFixture(
      {
        ...graph.semanticAudits[0],
        verdict: "MISSING_ASSERTION",
        gaps: [
          { code: "MISSING_ASSERTION", detail: "A stated duty is absent" },
        ],
      },
      RUN,
    );
  }
  const claimOwner = new Map<string, string>();
  for (const row of graph.sourceAccounting)
    for (const id of row.claimIds) claimOwner.set(id, row.sourceNodeId);
  const items = graph.sourceAccounting.map((r, ordinal) => ({
    preparationRunId: RUN,
    inventoryRevision: 1,
    sourceNodeId: r.sourceNodeId,
    ordinal,
    state:
      unreviewed && ordinal === 0
        ? SourceReviewState.PENDING
        : r.claimIds.length
          ? SourceReviewState.REVIEWED_WITH_CLAIMS
          : SourceReviewState.REVIEWED_NO_CLAIMS,
    claimIds: r.claimIds,
    disposition: r.claimIds.length
      ? "CLAIMS_AUTHORED"
      : "NO_RELEVANT_SEMANTIC_CLAIMS",
    reason: r.nonSemanticReason,
    completionFingerprint: "c".repeat(64),
    payload: {
      claims: graph.claims.filter(
        (c) => claimOwner.get(c.claimId) === r.sourceNodeId,
      ),
      identities: Object.fromEntries(
        Object.entries(identities).filter(
          ([id]) => claimOwner.get(id) === r.sourceNodeId,
        ),
      ),
      relations: [],
      referenceAccounting: [],
    },
  }));
  const reviewBinding = {
    revision: 1,
    fingerprint: FRONTIER,
    reviewedFingerprint: reviewedFrontierFingerprint(FRONTIER, items),
  };
  const candidate: LegalSemanticGraph = normalizeInventory({
    ...graph,
    reviewFrontier: reviewBinding,
  });
  return {
    source,
    graph: candidate,
    identities,
    items,
    audits: (graph.semanticAudits ?? []).map((receipt) => ({
      sourceNodeId: receipt.sourceNodeId,
      receipt,
    })),
  };
}

function harness(
  state: ReturnType<typeof persisted>,
  {
    run = {},
    frozen = null,
  }: { run?: Record<string, unknown>; frozen?: unknown } = {},
) {
  const calls = {
    inventoryCreate: jest.fn(),
    frontierUpdate: jest.fn(),
    runUpdate: jest.fn(),
  };
  const runRow = {
    id: RUN,
    claimInventoryRevision: 1,
    legalSourceVersionId: state.source.legalSourceVersionId,
    executionState: AgentExecutionState.RUNNING,
    claimPhase: ClaimPreparationPhase.CLAIM_DISCOVERY,
    claimDiscoveryOnly: false,
    failureReason: null,
    claimInventoryReopenReason: null,
    ...run,
  };
  const tx = {
    $queryRaw: jest.fn(),
    ruleSetPreparationRun: {
      findUnique: () => Promise.resolve(runRow),
      update: calls.runUpdate,
    },
    ruleSetPreparationClaimInventory: {
      findUnique: () => Promise.resolve(frozen),
      create: calls.inventoryCreate,
    },
    ruleSetPreparationReviewFrontier: {
      findUnique: () => Promise.resolve({ revision: 1, fingerprint: FRONTIER }),
      update: calls.frontierUpdate,
    },
    ruleSetPreparationSourceReview: {
      findMany: () => Promise.resolve(state.items),
    },
    ruleSetPreparationSemanticAudit: {
      findMany: () => Promise.resolve(state.audits),
    },
  };
  const handler = new ClaimInventoryHandler(
    {
      $transaction: (fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx)),
    } as unknown as PrismaService,
    {
      load: () => Promise.resolve({ snapshot: state.source }),
    } as unknown as LegalSourceSnapshotLoader,
  );
  const execute = (
    action: (typeof A)[keyof typeof A],
    fields: Record<string, unknown> = {},
  ) =>
    handler.execute(
      new ClaimInventoryCommand(
        claimInventoryOperationSchema.parse({
          preparationRunId: RUN,
          action,
          revision: 1,
          graph: state.graph,
          identities: state.identities,
          ...fields,
        }),
        "00000000-0000-4000-8000-0000000000aa",
      ),
    );
  return { execute, calls };
}

describe("CONCLUDE_NO_OPERATIVE_OBLIGATIONS (INV-C2)", () => {
  it("records the audited inventory and ends the Preparation FAILED with the explicit reason, creating no Rule Set", async () => {
    const state = persisted();
    const { execute, calls } = harness(state);
    const result = await execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS);
    expect(result).toMatchObject({
      outcome: O.PASSED,
      phase: P.COMPLETION,
      revision: 1,
      fingerprint: inventoryFingerprint(1, state.graph),
      failureReason: REASONS.NO_OPERATIVE_OBLIGATIONS,
    });
    expect(calls.inventoryCreate).toHaveBeenCalledTimes(1);
    expect(calls.inventoryCreate.mock.calls[0][0]).toMatchObject({
      data: {
        preparationRunId: RUN,
        revision: 1,
        fingerprint: inventoryFingerprint(1, state.graph),
        graphDigest: inventoryHash(state.graph),
      },
    });
    expect(calls.frontierUpdate).toHaveBeenCalledTimes(1);
    expect(calls.runUpdate).toHaveBeenCalledTimes(1);
    expect(calls.runUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: RUN },
      data: {
        claimPhase: ClaimPreparationPhase.COMPLETION,
        executionState: AgentExecutionState.FAILED,
        failureReason: RuleSetPreparationFailureReason.NO_OPERATIVE_OBLIGATIONS,
      },
    });
    // The check constraint couples FAILED with a recorded reason: both are written by the same update.
    expect(
      (calls.runUpdate.mock.calls[0][0] as { data: { completedAt: Date } }).data
        .completedAt,
    ).toBeInstanceOf(Date);
  });

  it("the worker failure callback can never record the reason: only this validated conclusion may", () => {
    expect(
      ruleSetPreparationFailRequestSchema.safeParse({
        preparationRunId: RUN,
        reason: REASONS.NO_OPERATIVE_OBLIGATIONS,
      }).success,
    ).toBe(false);
    for (const reason of [
      REASONS.MODEL_ERROR,
      REASONS.NO_SUBMISSION,
      REASONS.RUNTIME_ERROR,
    ]) {
      expect(
        ruleSetPreparationFailRequestSchema.safeParse({
          preparationRunId: RUN,
          reason,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    ["an unreviewed unit", persisted({ unreviewed: true }), G.INVALID],
    [
      "a missing independent audit",
      persisted({ audit: "missing" }),
      F.SEMANTIC_AUDIT_REQUIRED,
    ],
    [
      "a failed independent audit",
      persisted({ audit: "failed" }),
      F.SEMANTIC_AUDIT_REQUIRED,
    ],
    ["a stated duty", persisted({ duty: true }), F.claimPhaseInvalid],
  ])(
    "is rejected with its existing code and writes nothing for %s",
    async (_name, state, code) => {
      const { execute, calls } = harness(state);
      const result = (await execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS)) as {
        outcome: string;
        failures: { code: string }[];
      };
      expect(result.outcome).toBe(O.FAILED);
      expect(result.failures.map((f) => f.code)).toContain(code);
      expect(result.failures.map((f) => f.code)).not.toContain(
        F.OPERATIVE_CLAIM_MISSING,
      );
      expect(calls.inventoryCreate).not.toHaveBeenCalled();
      expect(calls.frontierUpdate).not.toHaveBeenCalled();
      expect(calls.runUpdate).not.toHaveBeenCalled();
    },
  );

  it("finalizing the same inventory is still refused for the absence of an operative claim (existing behavior unchanged)", async () => {
    const state = persisted();
    const { execute, calls } = harness(state);
    const result = (await execute(A.FINALIZE)) as {
      outcome: string;
      failures: { code: string }[];
    };
    expect(result.outcome).toBe(O.FAILED);
    expect(result.failures.map((f) => f.code)).toEqual([
      F.OPERATIVE_CLAIM_MISSING,
    ]);
    expect(calls.runUpdate).not.toHaveBeenCalled();
  });

  it("rejects a candidate that differs from the transactionally completed reviews", async () => {
    const state = persisted();
    const { execute, calls } = harness(state);
    const tampered = { ...state.graph, claims: [] };
    const result = (await execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS, {
      graph: tampered,
    })) as { outcome: string; failures: { code: string }[] };
    expect(result.outcome).toBe(O.FAILED);
    expect(result.failures[0].code).toBe(G.INVALID);
    expect(calls.runUpdate).not.toHaveBeenCalled();
  });

  it("is refused for a frozen inventory, a discovery-only diagnostic and a run that is not running", async () => {
    const state = persisted();
    const frozen = {
      revision: 1,
      fingerprint: inventoryFingerprint(1, state.graph),
    };
    for (const [options, code] of [
      [{ frozen }, G.FROZEN],
      [{ run: { claimDiscoveryOnly: true } }, G.PHASE],
      [{ run: { executionState: AgentExecutionState.CANCELLED } }, G.PHASE],
      [{ run: { claimPhase: ClaimPreparationPhase.RULE_AUTHORING } }, G.PHASE],
    ] as const) {
      const { execute, calls } = harness(state, options);
      const result = (await execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS)) as {
        outcome: string;
        failures: { code: string }[];
      };
      expect(result.outcome).toBe(O.FAILED);
      expect(result.failures[0].code).toBe(code);
      expect(calls.inventoryCreate).not.toHaveBeenCalled();
      expect(calls.runUpdate).not.toHaveBeenCalled();
    }
  });

  it("replays an accepted conclusion idempotently and never concludes a different inventory", async () => {
    const state = persisted();
    const fingerprint = inventoryFingerprint(1, state.graph);
    const run = {
      executionState: AgentExecutionState.FAILED,
      failureReason: RuleSetPreparationFailureReason.NO_OPERATIVE_OBLIGATIONS,
      claimPhase: ClaimPreparationPhase.COMPLETION,
    };
    const replay = harness(state, {
      run,
      frozen: { revision: 1, fingerprint },
    });
    expect(
      await replay.execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS),
    ).toMatchObject({
      outcome: O.PASSED,
      alreadyConcluded: true,
      failureReason: REASONS.NO_OPERATIVE_OBLIGATIONS,
      fingerprint,
    });
    expect(replay.calls.runUpdate).not.toHaveBeenCalled();
    const other = harness(state, {
      run,
      frozen: { revision: 1, fingerprint: "0".repeat(64) },
    });
    expect(
      await other.execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS),
    ).toMatchObject({ outcome: O.FAILED });
    // A run that failed for any other reason is never turned into this outcome.
    const unrelated = harness(state, {
      run: {
        executionState: AgentExecutionState.FAILED,
        failureReason: RuleSetPreparationFailureReason.NO_SUBMISSION,
      },
    });
    expect(
      await unrelated.execute(A.CONCLUDE_NO_OPERATIVE_OBLIGATIONS),
    ).toMatchObject({ outcome: O.FAILED });
    expect(unrelated.calls.runUpdate).not.toHaveBeenCalled();
  });
});
