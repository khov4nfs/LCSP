import { createHash } from "node:crypto";
import {
  LegalSourceLifecycleStatus,
  ArtifactLifecycleState,
  LegalRetrievalIndexStatus,
  type Prisma,
} from "@prisma/client";
import { loadRuleSetPreparationAvailability } from "../../src/modules/compliance-rule-set/infrastructure/persistence/rule-set-preparation-availability.loader.js";

/**
 * Business purpose: Inspect source/schema eligibility without authorizing a build.
 * Business rules: The caller must establish a read-only transaction; ambiguous sources and missing integrity/retrieval evidence block readiness. Metadata cannot authorize inference.
 * Execution flow: Read bounded source identities, required columns and existing availability; report explicit blockers and unverified runtime prerequisites.
 * Failure cases: Database/schema errors propagate to the diagnostic caller; missing columns avoid incompatible availability reads.
 * Side effects: Database reads only; no migration, source mutation, model or API dispatch.
 */
export async function collectPreparationPreflight(
  tx: Prisma.TransactionClient,
  endpoint: URL,
) {
  const sources = await tx.legalSourceVersion.findMany({
    where: { status: LegalSourceLifecycleStatus.ACTIVE },
    select: {
      id: true,
      version: true,
      status: true,
      activatedAt: true,
      createdAt: true,
      integrityManifestRef: true,
      sourceManifest: true,
      _count: { select: { documents: true, chunks: true } },
      activations: {
        where: { status: LegalSourceLifecycleStatus.ACTIVE },
        orderBy: { activatedAt: "desc" },
        take: 1,
        select: {
          integrityManifestRef: true,
          retrievalValidationRef: true,
        },
      },
      retrievalIndexes: {
        select: {
          status: true,
          validationManifestRef: true,
          validatedAt: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 11,
  });
  const columns = await tx.$queryRaw<
    Array<{ table_name: string; column_name: string }>
  >`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('ComplianceRuleSetVersion','RuleSetPreparationRun')`;
  const required = [
    ["ComplianceRuleSetVersion", "targetActivityScope"],
    ["RuleSetPreparationRun", "targetActivityScope"],
    ["RuleSetPreparationRun", "executionContract"],
    ["RuleSetPreparationRun", "claimPhase"],
    ["RuleSetPreparationRun", "claimInventoryRevision"],
  ];
  const schemaGaps = required
    .filter(
      ([table, column]) =>
        !columns.some(
          (item) => item.table_name === table && item.column_name === column,
        ),
    )
    .map(([table, column]) => `${table}.${column}`);
  const availability = schemaGaps.length
    ? null
    : await loadRuleSetPreparationAvailability(tx);
  const rules = await tx.complianceRuleSetVersion.findMany({
    where: {
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      legalSourceVersionId: { in: sources.map((source) => source.id) },
    },
    select: {
      id: true,
      version: true,
      ruleSetDigest: true,
      legalSourceVersionId: true,
    },
  });
  const runs = await tx.ruleSetPreparationRun.findMany({
    where: {
      legalSourceVersionId: { in: sources.map((source) => source.id) },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      legalSourceVersionId: true,
      executionState: true,
      failureReason: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  const blockers = [
    ...schemaGaps.map((column) => `SCHEMA_COLUMN_MISSING:${column}`),
    ...(sources.length !== 1
      ? ["ACTIVE_SOURCE_SELECTION_AMBIGUOUS_OR_MISSING"]
      : []),
    ...sources.flatMap((source) => {
      const activation = source.activations[0];
      const reasons: string[] = [];
      if (
        !source.integrityManifestRef ||
        activation?.integrityManifestRef !== source.integrityManifestRef
      )
        reasons.push(
          `SOURCE_INTEGRITY_EVIDENCE_MISSING_OR_MISMATCHED:${source.id}`,
        );
      if (
        !activation?.retrievalValidationRef ||
        !source.retrievalIndexes.some(
          (index) =>
            index.status === LegalRetrievalIndexStatus.VALID &&
            index.validatedAt !== null &&
            index.validationManifestRef === activation.retrievalValidationRef,
        )
      )
        reasons.push(
          `SOURCE_RETRIEVAL_EVIDENCE_MISSING_OR_MISMATCHED:${source.id}`,
        );
      return reasons;
    }),
  ];
  return {
    blockers,
    runtimePrerequisites: {
      checkpointCompatibility: "NOT_PROVEN",
      agentServerCompatibility: "NOT_PROVEN",
      executionContractAndScopeAgreement: "NOT_PROVEN",
      approvedInstructionBundle: "NOT_PROVEN",
      paidAdmissionAuthorization: "NOT_PROVEN",
    },
    canDispatch: false,
    database: {
      host: endpoint.hostname,
      port: endpoint.port,
      localDatabase: endpoint.pathname,
      readOnly: true,
    },
    schemaGaps,
    sourceDiscoveryTruncated: sources.length === 11,
    preflightState: blockers.length
      ? "BLOCKED_RUNTIME_CONFIGURATION"
      : "READ_ONLY_METADATA_COLLECTED",
    sources: sources.map(({ sourceManifest, ...source }) => ({
      ...source,
      diagnosticManifestJsonSha256: createHash("sha256")
        .update(JSON.stringify(sourceManifest))
        .digest("hex"),
      digestCaveat:
        "Diagnostic JSON serialization hash, not a substitute for the activated integrity-manifest identity",
    })),
    availability,
    activeRuleSets: rules,
    existingRuns: runs,
  };
}
