import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState } from "@prisma/client";
import {
  CLAIM_DISCOVERY_MODES,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
} from "@lcsp/contracts/compliance-rule-set";
import { SOURCE_REVIEW_GAPS as G } from "@lcsp/contracts/legal-source";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { StartClaimDiscoveryDiagnosticCommand } from "./source-review.command.js";

// Why: Diagnostic session creation has a separate lifecycle from source-review mutations.
// How: Nest registers this command handler independently while keeping its original guards and results.
// Invariant: Its isolated-database and feature-flag checks remain in force before any persistence.

@CommandHandler(StartClaimDiscoveryDiagnosticCommand)
export class StartClaimDiscoveryDiagnosticHandler implements ICommandHandler<StartClaimDiscoveryDiagnosticCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}
  /**
   * Business purpose: Start or reuse a source-only claim-discovery session for an explicitly isolated diagnostic environment.
   *
   * Business rules:
   * - Diagnostics require the feature flag and one of the explicitly allowed isolated staging or local review databases.
   * - The immutable Legal Source graph must already be materialized; the idempotency key cannot be reused for another source or a non-diagnostic run.
   * - This diagnostic run cannot author Rules or conclude a customer Preparation.
   *
   * Execution flow:
   * 1. Verify the diagnostic flag and database identity allowlist.
   * 2. Export the existing source graph and fail if it is unavailable.
   * 3. Create a RUNNING discovery-only diagnostic or reuse the same-key diagnostic without resetting its state, then verify its source/session identity.
   * 4. Load the source chunks and return the graph, run ID, and discovery-only mode.
   *
   * Failure cases:
   * - Disallowed environment, missing graph, or key collision returns a typed failed diagnostic outcome without starting a customer Preparation.
   * - Persistence, graph export, and chunk-read errors propagate.
   *
   * Side effects:
   * - May create the isolated discovery-only run and reads the existing graph/chunks; it does not enqueue paid Preparation work.
   */
  async execute(input: StartClaimDiscoveryDiagnosticCommand) {
    // Why: Environment variables can differ from the URL Prisma already used at startup.
    // How: Check the sanitized target captured from the actual adapter configuration.
    // Invariant: A permitted env string cannot authorize writes to another database.
    const target = this.prisma.databaseTarget;
    const isolated =
      !!target &&
      /^lcsp-release-staging-[a-f0-9]{16}-postgres$/u.test(target.hostname) &&
      target.pathname === "/lcsp_staging";
    const localTest =
      !!target &&
      ["127.0.0.1", "localhost"].includes(target.hostname) &&
      target.pathname === "/lcsp_review_frontier_test";
    if (
      process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED !== "true" ||
      !(isolated || localTest)
    )
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "diagnostic",
            detail:
              "Discovery-only sessions require an explicitly enabled isolated diagnostic database",
          },
        ],
      };
    const graph = await this.graph.export(input.legalSourceVersionId);
    if (!graph)
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "source",
            detail:
              "Materialize the immutable source graph before starting discovery",
          },
        ],
      };
    const run = await this.prisma.ruleSetPreparationRun.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        idempotencyKey: input.idempotencyKey,
        legalSourceVersionId: input.legalSourceVersionId,
        requestedBy: "claim-discovery-diagnostic",
        correlationId: input.idempotencyKey,
        claimDiscoveryOnly: true,
        executionState: AgentExecutionState.RUNNING,
        startedAt: new Date(),
      },
    });
    if (
      !run.claimDiscoveryOnly ||
      run.legalSourceVersionId !== input.legalSourceVersionId
    )
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "diagnostic",
            detail: "Diagnostic idempotency key targets another source/session",
          },
        ],
      };
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: { legalSourceVersionId: run.legalSourceVersionId },
    });
    return {
      outcome: O.PASSED,
      preparationRunId: run.id,
      mode: CLAIM_DISCOVERY_MODES.CLAIM_DISCOVERY_ONLY,
      documentGraph: graph,
      chunks,
    };
  }
}
