import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_DECISION_SCOPE,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
} from "@lcsp/contracts/assessment-report";
import { describe, expect, it, jest } from "@jest/globals";
import { ArtifactLifecycleState, AssessmentArtifactKind } from "@prisma/client";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import type { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import type { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import type { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { SubmitAssessmentFinalReportCommand } from "./submit-assessment-final-report.command.js";
import { SubmitAssessmentFinalReportHandler } from "./submit-assessment-final-report.handler.js";

const assessmentId = randomUUID();
const evidenceId = randomUUID();
const ruleSetId = randomUUID();
const snapshotId = randomUUID();
const legalSourceId = randomUUID();
const decision = ruleDecisionSchema.parse({
  assessmentRuleId: "ER-1",
  assessmentRuleVersion: "v1",
  scopeId: ASSESSMENT_DECISION_SCOPE,
  ruleSetVersionId: ruleSetId,
  repositorySnapshotId: snapshotId,
  repositoryCommit: "a".repeat(40),
  caseRevision: 1,
  legalContextRefs: [{ legalContextId: "LR-1" }],
  applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
  rationale: "The accepted evidence supports this outcome.",
  references: [
    {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId,
    },
  ],
  criteria: [
    {
      criterionId: "C-1",
      outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
      rationale: "The cited evidence supports the criterion.",
      references: [
        {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId,
        },
      ],
    },
  ],
  compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
});

function buildHandler(
  options: {
    existingArtifact?: unknown;
    storedContent?: string;
    storageFailure?: Error;
    phaseOneFailure?: Error;
    activationFailureOnce?: Error;
    uniqueRaceOnce?: boolean;
    uniqueRaceTarget?: unknown;
    builderFailure?: Error;
    activationMetadataDrift?: Record<string, unknown>;
    completionFailureOnce?: Error;
    authorizedLifecycleState?: string;
    repositorySnapshot?: { sourcePathPrefix: string | null } | null;
    repositoryScanJob?: {
      id: string;
      assessmentId: string;
      snapshotId: string;
      status: string;
      blockedReason: string | null;
    } | null;
  } = {},
) {
  const snapshot = {
    caseRevision: 1,
    pins: {
      ruleSetVersionId: ruleSetId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: "scan-1",
      repositoryCommit: "a".repeat(40),
    },
    decisions: [{ decisionId: randomUUID(), decisionRevision: 1, decision }],
    evidence: [
      {
        evidenceId,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        contentSha256: `sha256:${"b".repeat(64)}`,
        repositoryCommit: "a".repeat(40),
        source: { path: "src/retention.py", startLine: 3, endLine: 9 },
      },
    ],
    facts: [],
    legalProvenance: {},
  };
  const sourceChunk = {
    id: "chunk-1",
    legalSourceVersionId: legalSourceId,
    documentId: "DOC-1",
    locator: "article-1",
    contentSha256: `sha256:${"c".repeat(64)}`,
    legalStatus: "ACTIVE",
  };
  // This stateful row models metadata that survives the first transaction.
  // It lets the lifecycle tests distinguish an authoritative BUILDING commit
  // from activation work that must be safely retried in a later transaction.
  let persistedArtifact = options.existingArtifact ?? null;
  let activationFailure = options.activationFailureOnce;
  let uniqueRacePending = options.uniqueRaceOnce ?? false;
  const findExistingArtifact = jest.fn(() =>
    Promise.resolve(persistedArtifact),
  );
  const tx = {
    $queryRaw: jest.fn(() => {
      if (options.activationMetadataDrift && persistedArtifact) {
        persistedArtifact = {
          ...persistedArtifact,
          ...options.activationMetadataDrift,
        };
      }
      return Promise.resolve([]);
    }),
    authoredLocalizationRequest: {
      upsert: jest.fn((input: unknown) => Promise.resolve(input)),
    },
    assessmentArtifact: {
      findUnique: findExistingArtifact,
      create: jest.fn((payload: unknown) => {
        if (options.phaseOneFailure) {
          return Promise.reject(options.phaseOneFailure);
        }
        const data = Reflect.get(payload as object, "data") as object;
        persistedArtifact = { ...data };
        if (uniqueRacePending) {
          uniqueRacePending = false;
          return Promise.reject(
            Object.assign(new Error("concurrent final-report insert"), {
              code: "P2002",
              meta: {
                target: options.uniqueRaceTarget ?? ["assessmentId", "kind"],
              },
            }),
          );
        }
        return Promise.resolve(persistedArtifact);
      }),
      update: jest.fn((payload: unknown) => {
        if (activationFailure) {
          const failure = activationFailure;
          activationFailure = undefined;
          return Promise.reject(failure);
        }
        const data = Reflect.get(payload as object, "data") as object;
        persistedArtifact = { ...(persistedArtifact as object), ...data };
        return Promise.resolve(persistedArtifact);
      }),
    },
    repositorySnapshot: {
      findUnique: () => Promise.resolve(options.repositorySnapshot ?? null),
    },
    repositoryScanJob: {
      findUnique: () =>
        Promise.resolve(
          options.repositoryScanJob === undefined
            ? {
                id: "scan-1",
                assessmentId,
                snapshotId,
                status: "COMPLETED",
                blockedReason: null,
              }
            : options.repositoryScanJob,
        ),
    },
    complianceRuleSetVersion: {
      findUnique: () =>
        options.builderFailure
          ? Promise.reject(options.builderFailure)
          : Promise.resolve({
              id: ruleSetId,
              version: "rules-v1",
              ruleSetDigest: "d".repeat(64),
              legalSourceVersion: {
                id: legalSourceId,
                version: "source-v1",
                integrityManifestRef: null,
                documents: [
                  {
                    documentId: "DOC-1",
                    title: "Tài liệu kiểm thử về lưu trữ",
                  },
                ],
              },
            }),
    },
    assessmentRule: {
      findMany: () =>
        Promise.resolve([
          {
            assessmentRuleId: "ER-1",
            assessmentRuleVersion: "v1",
            concept: "Retention",
            legalIntent: "Records are retained.",
            applicabilityGuidance: "Applies to the system.",
            criteria: [{ criterionId: "C-1", statement: "Retention exists." }],
            contract: {
              sourceChunkIds: [sourceChunk.id],
              criteria: [
                { criterionId: "C-1", statement: "Retention exists." },
              ],
            },
            legalRequirementLinks: [
              {
                legalRequirementRowId: "req-1",
                legalRequirement: {
                  legalRequirementId: "LR-1",
                  title: "Retention requirement",
                  applicabilityConditions: ["The system stores records."],
                  qualifiers: [],
                  exceptions: [],
                  ordinal: 0,
                  provenance: [
                    {
                      documentId: sourceChunk.documentId,
                      locator: sourceChunk.locator,
                      contentSha256: sourceChunk.contentSha256,
                    },
                  ],
                },
              },
            ],
          },
        ]),
    },
    legalRequirement: {
      findMany: () =>
        Promise.resolve([
          {
            id: "req-1",
            legalRequirementId: "LR-1",
            title: "Retention requirement",
            proposition: "Records are retained.",
            applicabilityConditions: ["The system stores records."],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            coverageState: "COVERED_BY_ASSESSMENT_RULES",
            provenance: [
              {
                legalSourceVersionId: legalSourceId,
                documentId: sourceChunk.documentId,
                locator: sourceChunk.locator,
                contentSha256: sourceChunk.contentSha256,
              },
            ],
          },
        ]),
    },
    legalDocumentChunk: { findMany: () => Promise.resolve([sourceChunk]) },
    assessmentCaseFact: { findMany: () => Promise.resolve([]) },
    assessmentEvidence: {
      findMany: () =>
        Promise.resolve([
          {
            evidenceId,
            type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
            state: "ACCEPTED",
            repositoryCommit: "a".repeat(40),
            contentSha256: `sha256:${"b".repeat(64)}`,
            payload: { path: "src/retention.ts", startLine: 1, endLine: 2 },
          },
        ]),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => {
      const beforeTransaction = persistedArtifact;
      try {
        return await callback(tx);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null
            ? (error as Record<string, unknown>).code
            : undefined;
        // P2002 models a different transaction's committed winner; all other
        // failures roll this transaction's artifact mutation back.
        if (code !== "P2002") persistedArtifact = beforeTransaction;
        throw error;
      }
    }),
  } as unknown as PrismaService;
  const authority = {
    authorizeInTx: jest.fn(() => {
      const persistedLifecycleState =
        typeof persistedArtifact === "object" &&
        persistedArtifact !== null &&
        "lifecycleState" in persistedArtifact
          ? persistedArtifact.lifecycleState
          : undefined;
      return Promise.resolve({
        assessmentId,
        threadId: randomUUID(),
        executionId: randomUUID(),
        lifecycleState:
          options.authorizedLifecycleState ??
          (persistedLifecycleState === ArtifactLifecycleState.ACTIVE
            ? ASSESSMENT_LIFECYCLE_STATES.COMPLETE
            : ASSESSMENT_LIFECYCLE_STATES.FINALIZING),
        lifecycleRevision: 2,
      });
    }),
  } as unknown as AssessmentRuntimeAuthority;
  const completionGate = {
    inspectInTx: jest.fn(() =>
      Promise.resolve({
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
        blockers: [],
        snapshot,
      }),
    ),
  } as unknown as AssessmentCompletionGate;
  let completionFailure = options.completionFailureOnce;
  const transitionVerifiedInTx = jest.fn(() => {
    if (completionFailure) {
      const failure = completionFailure;
      completionFailure = undefined;
      return Promise.reject(failure);
    }
    return Promise.resolve();
  });
  const coordinator = {
    transitionVerifiedInTx,
  } as unknown as AssessmentLifecycleCoordinator;
  const events = {
    appendInTx: jest.fn(),
  } as unknown as AssessmentEventAppender;
  const writeImmutableArtifact = jest.fn(
    (artifactId: string, content: string) => {
      if (options.storageFailure) {
        return Promise.reject(options.storageFailure);
      }
      const hash = sha256Hex(content);
      return {
        manifest: {
          artifact_id: artifactId,
          total_size: Buffer.byteLength(content),
          hash,
          chunks: [`${hash}.chunk`],
        },
        sizeBytes: Buffer.byteLength(content),
      };
    },
  );
  const readAndReconstruct = jest.fn(() =>
    Promise.resolve(options.storedContent ?? ""),
  );
  const eraseImmutableArtifact = jest.fn(() => Promise.resolve());
  const storage = {
    writeImmutableArtifact,
    readAndReconstruct,
    eraseImmutableArtifact,
  } as unknown as ArtifactStorageService;
  return {
    handler: new SubmitAssessmentFinalReportHandler(
      prisma,
      authority,
      completionGate,
      coordinator,
      events,
      storage,
    ),
    findExistingArtifact,
    writeImmutableArtifact,
    eraseImmutableArtifact,
    readAndReconstruct,
    tx,
    persistedArtifact: () => persistedArtifact,
    transitionVerifiedInTx,
  };
}

describe("SubmitAssessmentFinalReportHandler", () => {
  const unresolvedTextCases: Array<{
    label: string;
    summary?: string;
    findingSummary?: string;
    recommendation?: string;
  }> = [
    { label: "UNKNOWN in report summary", summary: "UNKNOWN" },
    { label: "PARTIAL in finding summary", findingSummary: "PARTIAL" },
    {
      label: "NEEDS_CONTEXT in recommendation",
      recommendation: "NEEDS_CONTEXT",
    },
    {
      label: "unresolved question in finding summary",
      findingSummary: "There is an unresolved question.",
    },
    {
      label: "open question in recommendation",
      recommendation: "An open question.",
    },
    { label: "TBD in report summary", summary: "TBD verdict" },
  ];

  const requestFor = (text: {
    summary?: string;
    findingSummary?: string;
    recommendation?: string;
  }) => ({
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    summary: text.summary ?? "The assessment is complete.",
    findings: [
      {
        assessmentRuleId: "ER-1",
        summary:
          text.findingSummary ?? "The accepted rule decision is complete.",
        recommendations: text.recommendation ? [text.recommendation] : [],
      },
    ],
  });

  it.each(unresolvedTextCases)(
    "rejects $label on new submission",
    async (text) => {
      const { handler, writeImmutableArtifact, tx } = buildHandler();
      const command = new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor(text),
        randomUUID(),
      );

      await expect(handler.execute(command)).rejects.toMatchObject({
        response: {
          problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID },
        },
      });
      expect(writeImmutableArtifact).not.toHaveBeenCalled();
      expect(tx.assessmentArtifact.findUnique).toHaveBeenCalledTimes(1);
    },
  );

  it("persists a V3 artifact only after canonical assembly", async () => {
    const { handler, writeImmutableArtifact, tx } = buildHandler();
    const result = await handler.execute(
      new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor({}),
        randomUUID(),
      ),
    );

    expect(result.replayed).toBe(false);
    expect(result.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(writeImmutableArtifact).toHaveBeenCalledTimes(1);
    expect(tx.assessmentArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
        }),
      }),
    );
  });

  it("[RED][ASM-REPORT-01B] preserves authoritative BUILDING metadata when storage fails", async () => {
    const storageFailure = Object.assign(
      new Error("private storage unavailable"),
      {
        code: "ETIMEDOUT",
      },
    );
    const { handler, tx, persistedArtifact, transitionVerifiedInTx } =
      buildHandler({
        storageFailure,
      });

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as { getStatus(): number };

    expect(failure.getStatus()).toBe(503);
    expect(persistedArtifact()).toMatchObject({
      lifecycleState: ArtifactLifecycleState.BUILDING,
      reportRequestDigest: expect.any(String),
      contentSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      sizeBytes: expect.any(Number),
      storageRef: expect.any(String),
    });
    expect(tx.assessmentArtifact.create).toHaveBeenCalledTimes(1);
    expect(tx.assessmentArtifact.update).not.toHaveBeenCalled();
    expect(transitionVerifiedInTx).not.toHaveBeenCalled();
  });

  it("[RED][ASM-REPORT-01A] never writes storage before BUILDING commits", async () => {
    const phaseOneFailure = Object.assign(new Error("database unavailable"), {
      code: "P1001",
    });
    const { handler, tx, writeImmutableArtifact, eraseImmutableArtifact } =
      buildHandler({ phaseOneFailure });

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as { getStatus(): number };

    // The authoritative BUILDING row must commit before any shared chunk is
    // written, so a database failure cannot create unreachable storage bytes.
    expect(failure.getStatus()).toBe(503);
    expect(writeImmutableArtifact).not.toHaveBeenCalled();
    expect(eraseImmutableArtifact).not.toHaveBeenCalled();
    expect(tx.assessmentArtifact.update).not.toHaveBeenCalled();
  });

  it("[RED][ASM-REPORT-01C] resumes the same BUILDING artifact after activation fails", async () => {
    const request = requestFor({});
    const { handler, tx, persistedArtifact, eraseImmutableArtifact } =
      buildHandler({ activationFailureOnce: new Error("activation failed") });
    const submit = () =>
      handler.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          request,
          randomUUID(),
        ),
      );

    await expect(submit()).rejects.toThrow();
    const buildingArtifactId = (persistedArtifact() as { artifactId?: unknown })
      .artifactId;
    expect(typeof buildingArtifactId).toBe("string");
    if (typeof buildingArtifactId !== "string") {
      throw new Error(
        "Expected the BUILDING artifact identifier to be a string",
      );
    }
    expect(persistedArtifact()).toMatchObject({
      lifecycleState: ArtifactLifecycleState.BUILDING,
    });

    const retried = await submit();

    expect(retried.artifactId).toBe(buildingArtifactId);
    expect(retried.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(tx.assessmentArtifact.create).toHaveBeenCalledTimes(1);
    expect(persistedArtifact()).toMatchObject({
      artifactId: buildingArtifactId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
    });
    expect(eraseImmutableArtifact).not.toHaveBeenCalled();
  });

  it("[ASM-REPORT-01C] reloads the winner of a same-digest unique-row race", async () => {
    const { handler, tx, persistedArtifact } = buildHandler({
      uniqueRaceOnce: true,
    });

    const result = await handler.execute(
      new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor({}),
        randomUUID(),
      ),
    );

    expect(result.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(tx.assessmentArtifact.create).toHaveBeenCalledTimes(1);
    expect(persistedArtifact()).toMatchObject({
      artifactId: result.artifactId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
    });
  });

  it("[ASM-REPORT-01C] reloads the winner when Prisma reports the unique constraint name", async () => {
    const { handler, tx, persistedArtifact } = buildHandler({
      uniqueRaceOnce: true,
      uniqueRaceTarget: "AssessmentArtifact_assessmentId_kind_key",
    });

    const result = await handler.execute(
      new SubmitAssessmentFinalReportCommand(
        assessmentId,
        randomUUID(),
        requestFor({}),
        randomUUID(),
      ),
    );

    expect(result.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(tx.assessmentArtifact.create).toHaveBeenCalledTimes(1);
    expect(persistedArtifact()).toMatchObject({
      artifactId: result.artifactId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
    });
  });

  it("[ASM-REPORT-01C] rejects a different digest while BUILDING before storage", async () => {
    const { handler, writeImmutableArtifact, persistedArtifact } = buildHandler(
      {
        existingArtifact: {
          artifactId: randomUUID(),
          assessmentId,
          kind: AssessmentArtifactKind.FINAL_REPORT,
          lifecycleState: ArtifactLifecycleState.BUILDING,
          reportRequestDigest: "different-request-digest",
        },
      },
    );

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as {
      getResponse(): { problem: { code: string } };
      getStatus(): number;
    };

    expect(failure.getStatus()).toBe(409);
    expect(failure.getResponse().problem.code).toBe(
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_ALREADY_CREATED,
    );
    expect(writeImmutableArtifact).not.toHaveBeenCalled();
    expect(persistedArtifact()).toMatchObject({
      lifecycleState: ArtifactLifecycleState.BUILDING,
      reportRequestDigest: "different-request-digest",
    });
  });

  it("[RED][ASM-REPORT-01C] refuses activation when authoritative BUILDING pins drift", async () => {
    const { handler, tx, persistedArtifact } = buildHandler({
      activationMetadataDrift: { ruleSetVersionId: randomUUID() },
    });

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as { getStatus(): number };

    expect(failure.getStatus()).toBe(409);
    expect(tx.assessmentArtifact.update).not.toHaveBeenCalled();
    expect(persistedArtifact()).toMatchObject({
      lifecycleState: ArtifactLifecycleState.BUILDING,
    });
  });

  it("[RED][ASM-REPORT-02] reports builder database outages as masked 503", async () => {
    const builderFailure = Object.assign(new Error("private database host"), {
      code: "P1001",
    });
    const { handler, writeImmutableArtifact } = buildHandler({
      builderFailure,
    });

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          requestFor({}),
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as {
      getResponse(): unknown;
      getStatus(): number;
    };

    expect(failure.getStatus()).toBe(503);
    expect(JSON.stringify(failure.getResponse())).not.toMatch(
      /private database host|P1001/u,
    );
    expect(writeImmutableArtifact).not.toHaveBeenCalled();
  });

  it("[ASM-REPORT-01C] rolls back ACTIVE when completion fails and resumes from BUILDING", async () => {
    const request = requestFor({});
    const { handler, tx, persistedArtifact } = buildHandler({
      completionFailureOnce: new Error("completion transition failed"),
    });
    const submit = () =>
      handler.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          request,
          randomUUID(),
        ),
      );

    await expect(submit()).rejects.toThrow();
    expect(persistedArtifact()).toMatchObject({
      lifecycleState: ArtifactLifecycleState.BUILDING,
    });
    expect(tx.assessmentArtifact.update).toHaveBeenCalledTimes(1);

    const retried = await submit();

    expect(retried.lifecycleState).toBe(ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
    expect(persistedArtifact()).toMatchObject({
      artifactId: retried.artifactId,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
    });
  });

  it("refuses an ACTIVE replay when the authoritative Assessment is not COMPLETE", async () => {
    const request = requestFor({});
    const { handler, readAndReconstruct } = buildHandler({
      authorizedLifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
      existingArtifact: {
        artifactId: randomUUID(),
        assessmentId,
        kind: AssessmentArtifactKind.FINAL_REPORT,
        lifecycleState: ArtifactLifecycleState.ACTIVE,
        reportRequestDigest: sha256Hex(canonicalJson(request)),
        contentSha256: `sha256:${"a".repeat(64)}`,
        sizeBytes: 1,
        storageRef: JSON.stringify({
          artifact_id: randomUUID(),
          total_size: 1,
          hash: "a".repeat(64),
          chunks: [`${"a".repeat(64)}.chunk`],
        }),
      },
    });

    const failure = (await handler
      .execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          request,
          randomUUID(),
        ),
      )
      .catch((error: unknown) => error)) as { getStatus(): number };

    expect(failure.getStatus()).toBe(409);
    expect(readAndReconstruct).not.toHaveBeenCalled();
  });

  it("rejects unresolved text while replaying an immutable artifact", async () => {
    const request = requestFor({
      recommendation: "There is an unresolved question.",
    });
    const artifactId = randomUUID();
    const decisionId = randomUUID();
    const report = assessmentFinalReportArtifactSchema.parse({
      schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
      artifactId,
      assessmentId,
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      pins: {
        ruleSetVersionId: ruleSetId,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: "scan-1",
        repositoryCommit: "a".repeat(40),
      },
      caseRevision: 1,
      decisionFingerprint: `sha256:${sha256Hex(
        canonicalJson([{ decisionId, decisionRevision: 1, decision }]),
      )}`,
      summary: request.summary,
      findings: [
        {
          assessmentRuleId: "ER-1",
          decisionId,
          decisionRevision: 1,
          decision,
          summary: request.findings[0].summary,
          recommendations: request.findings[0].recommendations,
        },
      ],
      provenance: {
        evidenceIds: [evidenceId],
        factIds: [],
        searchCoverageEvidenceIds: [],
      },
    });
    const storedContent = canonicalJson(report);
    const contentHash = sha256Hex(storedContent);
    const manifest = {
      artifact_id: artifactId,
      total_size: Buffer.byteLength(storedContent, "utf8"),
      hash: contentHash,
      chunks: ["artifact.chunk"],
    };
    const existingArtifact = {
      artifactId,
      assessmentId,
      kind: AssessmentArtifactKind.FINAL_REPORT,
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      ruleSetVersionId: ruleSetId,
      repositorySnapshotId: snapshotId,
      repositoryCommit: "a".repeat(40),
      caseRevision: 1,
      schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
      reportRequestDigest: sha256Hex(canonicalJson(request)),
      contentSha256: `sha256:${contentHash}`,
      sizeBytes: Buffer.byteLength(storedContent, "utf8"),
      storageRef: JSON.stringify(manifest),
    };
    const { handler, writeImmutableArtifact } = buildHandler({
      existingArtifact,
      storedContent,
    });

    await expect(
      handler.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          randomUUID(),
          request,
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID },
      },
    });
    expect(writeImmutableArtifact).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "sourcePathPrefix differs from the repository snapshot",
      repositorySnapshot: { sourcePathPrefix: "different/path" },
      repositoryScanJob: undefined,
    },
    {
      caseName: "repositoryScanJob belongs to a different snapshot",
      repositorySnapshot: { sourcePathPrefix: "services/core" },
      repositoryScanJob: {
        id: "scan-1",
        assessmentId,
        snapshotId: randomUUID(),
        status: "COMPLETED",
        blockedReason: null,
      },
    },
  ])(
    "rejects V3 report replay when $caseName",
    async ({ repositorySnapshot, repositoryScanJob }) => {
      const request = requestFor({});
      const artifactId = randomUUID();
      const decisionId = randomUUID();
      const v3Report = {
        schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
        artifactId,
        assessmentId,
        kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        identity: {
          repositorySnapshotId: snapshotId,
          repositoryCommit: "a".repeat(40),
        },
        pins: {
          ruleSetVersionId: ruleSetId,
          ruleSetVersion: "rules-v1",
          ruleSetDigest: "d".repeat(64),
          legalSourceVersionId: legalSourceId,
          legalSourceVersion: "source-v1",
          repositorySnapshotId: snapshotId,
          repositoryScanJobId: "scan-1",
          repositoryCommit: "a".repeat(40),
          sourcePathPrefix: "services/core",
        },
        caseRevision: 1,
        decisionFingerprint: `sha256:${sha256Hex(
          canonicalJson([{ decisionId, decisionRevision: 1, decision }]),
        )}`,
        sourceScope: {
          mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
          visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
          sourcePathPrefix: "services/core",
          excludedPaths: [],
          limitationReasons: [
            ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
          ],
          searchCoverageEvidenceIds: [],
        },
        legalRequirements: [
          {
            legalRequirementId: "LR-1",
            title: "Retention mandate",
            proposition: "Records must be retained.",
            applicabilityConditions: [],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            coverageState: "COVERED_BY_ASSESSMENT_RULES",
            sourceRefs: [
              {
                legalSourceVersionId: legalSourceId,
                legalSourceVersion: "source-v1",
                documentId: "DOC-1",
                locator: "article-1",
                contentSha256: `sha256:${"c".repeat(64)}`,
              },
            ],
          },
        ],
        ruleDetails: [
          {
            assessmentRuleId: "ER-1",
            assessmentRuleVersion: "v1",
            legalRequirementIds: ["LR-1"],
            relatedLegalContexts: [],
            concept: "Retention",
            legalIntent: "Records are retained.",
            applicabilityGuidance: "Applies to system.",
            criteria: [{ criterionId: "C-1", statement: "Retention exists." }],
            decisionId,
            decisionRevision: 1,
            decision,
            decisionReferences: [
              {
                origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision,
                reference: {
                  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                  evidenceId,
                },
              },
            ],
            applicabilityBasisReferences: [],
            factEvidenceReferences: [],
            criteriaDecisions: [
              {
                criterionId: "C-1",
                outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
                rationale: "The cited evidence supports the criterion.",
                references: [
                  {
                    origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion,
                    reference: {
                      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                      evidenceId,
                    },
                  },
                ],
              },
            ],
            narrative: {
              summary: "Rule summary.",
              recommendations: [],
            },
            factIds: [],
            evidenceIds: [evidenceId],
            sourceRefs: [
              {
                legalSourceVersionId: legalSourceId,
                legalSourceVersion: "source-v1",
                documentId: "DOC-1",
                locator: "article-1",
                contentSha256: `sha256:${"c".repeat(64)}`,
              },
            ],
          },
        ],
        factIndex: [],
        evidenceIndex: [
          {
            evidenceId,
            type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
            contentSha256: `sha256:${"b".repeat(64)}`,
            repositoryCommit: "a".repeat(40),
            safeLocator: "services/core/retention.ts:1-2",
          },
        ],
        outcomeSummary: {
          totalRules: 1,
          applicableCompliant: 1,
          applicableNonCompliant: 0,
          notApplicable: 0,
        },
        boundedNarrative: {
          summary: "The assessment is complete.",
          scopeLimitations: ["PARTIAL_COVERAGE_RECORDED"],
        },
        boundedActionPlan: {
          maxHighlightItems: 200,
          totalRecommendations: 0,
          omittedCount: 0,
          truncated: false,
          items: [],
        },
        publicationProvenance: {
          sourceManifestDigest: null,
          publishedAt: null,
        },
      };
      const storedContent = canonicalJson(v3Report);
      const contentHash = sha256Hex(storedContent);
      const manifest = {
        artifact_id: artifactId,
        total_size: Buffer.byteLength(storedContent, "utf8"),
        hash: contentHash,
        chunks: ["artifact.chunk"],
      };
      const existingArtifact = {
        artifactId,
        assessmentId,
        kind: AssessmentArtifactKind.FINAL_REPORT,
        lifecycleState: ArtifactLifecycleState.ACTIVE,
        ruleSetVersionId: ruleSetId,
        repositorySnapshotId: snapshotId,
        repositoryCommit: "a".repeat(40),
        caseRevision: 1,
        schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
        reportRequestDigest: sha256Hex(canonicalJson(request)),
        contentSha256: `sha256:${contentHash}`,
        sizeBytes: Buffer.byteLength(storedContent, "utf8"),
        storageRef: JSON.stringify(manifest),
      };

      const { handler } = buildHandler({
        existingArtifact,
        storedContent,
        repositorySnapshot,
        repositoryScanJob,
      });

      const failure = (await handler
        .execute(
          new SubmitAssessmentFinalReportCommand(
            assessmentId,
            randomUUID(),
            request,
            randomUUID(),
          ),
        )
        .catch((error: unknown) => error)) as {
        getResponse(): { problem: { code: string } };
        getStatus(): number;
      };

      // Integrity failures remain observable through the stable problem code,
      // while internal pin details are intentionally masked from API clients.
      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse().problem.code).toBe(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      );
    },
  );
});
