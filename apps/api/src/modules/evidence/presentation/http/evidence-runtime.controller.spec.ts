import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_NAMES,
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
} from "@lcsp/contracts/evidence";
import { NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { InternalAgenticToolDispatchController } from "./agentic-tool-dispatch.controller.js";
import { InternalEvidenceController } from "./evidence.controller.js";

function buildController() {
  const technicalEvidenceReportFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const technicalProfileFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const commandBus = {
    execute: jest.fn<(query?: unknown) => Promise<{ status: string }>>(),
  };
  const prisma = {
    technicalEvidenceReport: { findUnique: technicalEvidenceReportFindUnique },
    technicalProfile: { findUnique: technicalProfileFindUnique },
  } as unknown as PrismaService;

  return {
    controller: new InternalEvidenceController(commandBus as never, prisma),
    technicalEvidenceReportFindUnique,
    technicalProfileFindUnique,
  };
}

describe("InternalEvidenceController runtime reads", () => {
  it("returns the accepted evidence report in worker snake_case shape", async () => {
    const { controller, technicalEvidenceReportFindUnique } = buildController();
    technicalEvidenceReportFindUnique.mockResolvedValue({
      id: "report-1",
      scanJobId: "scan-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      toolsVersion: { semgrep: "1.0" },
      configHash: { semgrep: "sha256:test" },
      evidencePayload: { technical_findings: [] },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "1.0.0",
      status: "ACCEPTED",
      rejectionReason: null,
      createdAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    const result = await controller.getTechnicalEvidenceReport("report-1");

    expect(technicalEvidenceReportFindUnique).toHaveBeenCalledTimes(1);
    const [findUniqueArgs] =
      technicalEvidenceReportFindUnique.mock.calls[0] ?? [];
    expect(findUniqueArgs).toEqual({
      where: { id: "report-1" },
      select: {
        id: true,
        scanJobId: true,
        assessmentId: true,
        organizationId: true,
        snapshotId: true,
        toolsVersion: true,
        configHash: true,
        evidencePayload: true,
        privacyFlags: true,
        schemaVersion: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    expect(result).toMatchObject({
      id: "report-1",
      scan_job_id: "scan-1",
      assessment_id: "assessment-1",
      organization_id: "org-1",
      snapshot_id: "snapshot-1",
      evidence_payload: { technical_findings: [] },
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      schema_version: "1.0.0",
      status: "accepted",
    });
  });

  it("flattens profileData while keeping persisted identifiers authoritative", async () => {
    const { controller, technicalProfileFindUnique } = buildController();
    technicalProfileFindUnique.mockResolvedValue({
      id: "profile-1",
      evidenceReportId: "report-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "technical-profile-worker@1",
      profileData: {
        id: "spoofed-id",
        assessment_id: "spoofed-assessment",
        ai_detected: "confirmed",
        dependency_ai_packages: ["openai"],
      },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: "ACCEPTED",
      rejectionReason: null,
      createdAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    const result = await controller.getTechnicalProfile("profile-1");

    expect(result).toMatchObject({
      id: "profile-1",
      technical_profile_id: "profile-1",
      evidence_report_id: "report-1",
      assessment_id: "assessment-1",
      organization_id: "org-1",
      ai_detected: "confirmed",
      dependency_ai_packages: ["openai"],
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      status: "accepted",
    });
  });

  it("returns 404 for missing worker artifacts", async () => {
    const {
      controller,
      technicalEvidenceReportFindUnique,
      technicalProfileFindUnique,
    } = buildController();
    technicalEvidenceReportFindUnique.mockResolvedValue(null);
    technicalProfileFindUnique.mockResolvedValue(null);

    await expect(
      controller.getTechnicalEvidenceReport("missing-report"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getTechnicalProfile("missing-profile"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("InternalAgenticToolDispatchController", () => {
  it("dispatches get_scan_coverage to QueryBus with pinned artifact versions", async () => {
    const execute = jest
      .fn<(query?: unknown) => Promise<{ status: string }>>()
      .mockResolvedValue({ status: "READY" });
    const pythonWorkerRuntime = {
      requestTargetedReanalysis: jest.fn(),
      resumeWaitingRuns: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockReturnValue(false),
    };
    const controller = new InternalAgenticToolDispatchController(
      {
        execute,
      } as never,
      pythonWorkerRuntime as never,
      configService as never,
    );

    await controller.dispatch({
      tool_name: "get_scan_coverage",
      assessment_id: "assessment-1",
      organization_id: "org-1",
      user_id: "user-1",
      artifact_versions: {
        technicalEvidenceReportId: "report-1",
      },
      input: {
        maxResults: 10,
        pathPrefixes: ["apps/api/"],
        languages: ["TYPESCRIPT"],
        dispositions: ["ANALYZED"],
        cursor: "abc",
      },
      correlationId: "corr-1",
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        maxResults: 10,
        pathPrefixes: ["apps/api/"],
        languages: ["TYPESCRIPT"],
        dispositions: ["ANALYZED"],
        cursor: "abc",
      }),
    );
  });

  it.each([
    {
      name: "search_evidence",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.searchEvidence,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          maxResults: 15,
          findingKinds: ["AI_INVOCATION"],
          providers: ["OPENAI"],
          pathPrefixes: ["apps/api/"],
          minConfidence: "HIGH",
          cursor: "cursor-1",
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        maxResults: 15,
        correlationId: "corr-1",
        findingKinds: ["AI_INVOCATION"],
        providers: ["OPENAI"],
        pathPrefixes: ["apps/api/"],
        minConfidence: "HIGH",
        cursor: "cursor-1",
      },
    },
    {
      name: "get_finding_detail",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getFindingDetail,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          findingId: "finding:finding-1",
          include: ["LOCATION", "RELATED_REFS"],
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        findingId: "finding-1",
        include: ["LOCATION", "RELATED_REFS"],
        correlationId: "corr-1",
      },
    },
    {
      name: "find_provider_invocations",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.findProviderInvocations,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          provider: "OPENAI",
          framework: "LANGCHAIN",
          pathPrefixes: ["apps/api/"],
          maxResults: 10,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        maxResults: 10,
        correlationId: "corr-1",
        provider: "OPENAI",
        pathPrefixes: ["apps/api/"],
        framework: "LANGCHAIN",
      },
    },
    {
      name: "get_evidence_subgraph",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getEvidenceSubgraph,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          seedRef: "node:seed-1",
          direction: "BOTH",
          maxDepth: 3,
          maxNodes: 15,
          maxEdges: 20,
          nodeTypes: ["FILE", "FUNCTION"],
          edgeTypes: ["CALLS"],
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        seedNodeId: "seed-1",
        direction: "BOTH",
        maxDepth: 3,
        maxNodes: 15,
        maxEdges: 20,
        correlationId: "corr-1",
        nodeTypes: ["FILE", "FUNCTION"],
        edgeTypes: ["CALLS"],
      },
    },
    {
      name: "get_symbol_context",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getSymbolContext,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          symbolRef: "symbol:symbol-1",
          include: ["CATEGORIES", "CALLERS"],
          maxNeighbors: 8,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        symbolNodeId: "symbol-1",
        include: ["CATEGORIES", "CALLERS"],
        maxNeighbors: 8,
        correlationId: "corr-1",
      },
    },
    {
      name: "trace_static_flow",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.traceStaticFlow,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          startRef: "node:start-1",
          direction: "FORWARD",
          maxHops: 4,
          desiredStages: ["INPUT", "INVOCATION"],
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        startNodeId: "start-1",
        direction: "FORWARD",
        maxHops: 4,
        correlationId: "corr-1",
        desiredStages: ["INPUT", "INVOCATION"],
      },
    },
    {
      name: "inspect_human_review_path",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.inspectHumanReviewPath,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          startRef: "node:start-1",
          reviewKinds: ["QUEUE", "APPROVAL"],
          maxHops: 4,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        startNodeId: "start-1",
        reviewKinds: ["QUEUE", "APPROVAL"],
        maxHops: 4,
        correlationId: "corr-1",
      },
    },
    {
      name: "inspect_decision_path",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.inspectDecisionPath,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          startRef: "node:start-1",
          actionCategories: ["APPROVE", "REJECT"],
          maxHops: 3,
          maxResults: 7,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        startNodeId: "start-1",
        actionCategories: ["APPROVE", "REJECT"],
        maxHops: 3,
        maxResults: 7,
        correlationId: "corr-1",
      },
    },
    {
      name: "inspect_data_path",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.inspectDataPath,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          startRef: "node:start-1",
          direction: "BACKWARD",
          dataCategories: ["LEGAL"],
          maxHops: 6,
          maxResults: 12,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        startNodeId: "start-1",
        direction: "BACKWARD",
        dataCategories: ["LEGAL"],
        maxHops: 6,
        maxResults: 12,
        correlationId: "corr-1",
      },
    },
    {
      name: "find_similar_symbols",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.findSimilarSymbols,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          seedSymbolRef: "symbol:seed-1",
          dimensions: ["IMPORTS", "DATA_FLOW"],
          pathPrefixes: ["apps/web/"],
          maxResults: 9,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        seedNodeId: "seed-1",
        dimensions: ["IMPORTS", "DATA_FLOW"],
        maxResults: 9,
        correlationId: "corr-1",
        pathPrefixes: ["apps/web/"],
      },
    },
    {
      name: "inspect_deployment_context",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.inspectDeploymentContext,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: {
          manifestKinds: ["CONTAINER", "KUBERNETES"],
          environments: ["PRODUCTION"],
          pathPrefixes: ["deploy/"],
          cursor: "cursor-3",
          maxResults: 11,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        evidenceReportId: "report-1",
        manifestKinds: ["CONTAINER", "KUBERNETES"],
        environments: ["PRODUCTION"],
        maxResults: 11,
        correlationId: "corr-1",
        pathPrefixes: ["deploy/"],
        cursor: "cursor-3",
      },
    },
    {
      name: "get_assessment_context",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getAssessmentContext,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { wizardProfileId: "wizard-1" },
        input: {
          include: [
            ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
            ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
          ],
          answerFields: [
            ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose,
            ASSESSMENT_CONTEXT_ANSWER_FIELDS.providerDeclaration,
          ],
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        wizardProfileId: "wizard-1",
        includes: [
          ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
          ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
        ],
        answerFields: [
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose,
          ASSESSMENT_CONTEXT_ANSWER_FIELDS.providerDeclaration,
        ],
        correlationId: "corr-1",
      },
    },
    {
      name: "get_artifact_chain",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getArtifactChain,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: {
          anchor: { artifactRef: "flow:flow-1" },
          requiredStages: [
            ARTIFACT_CHAIN_STAGES.technicalEvidence,
            ARTIFACT_CHAIN_STAGES.verifiedProfile,
          ],
          exactVersions: true,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        correlationId: "corr-1",
        artifactRef: "flow:flow-1",
        requiredStages: [
          ARTIFACT_CHAIN_STAGES.technicalEvidence,
          ARTIFACT_CHAIN_STAGES.verifiedProfile,
        ],
        exactVersions: true,
      },
    },
    {
      name: "get_reconciliation_context",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getReconciliationContext,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: {
          flowRef: "flow:flow-1",
          conflictIds: ["conflict:one", "conflict:two"],
          statuses: ["OPEN", "RESOLVED"],
          cursor: "cursor-2",
          maxResults: 20,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        correlationId: "corr-1",
        aiUsageFlowId: "flow-1",
        conflictIds: ["one", "two"],
        cursor: "cursor-2",
        maxResults: 20,
        statuses: ["OPEN", "RESOLVED"],
      },
    },
    {
      name: "propose_missing_targets",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.proposeMissingTargets,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {
          wizardProfileId: "wizard-1",
          technicalEvidenceReportId: "report-1",
        },
        input: {
          candidateKinds: ["PROVIDER_USAGE", "DEPLOYMENT"],
          seedRefs: ["symbol:ingress-1"],
          excludeTargetIds: ["target-1"],
          maxResults: 10,
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        wizardProfileId: "wizard-1",
        evidenceReportId: "report-1",
        candidateKinds: ["PROVIDER_USAGE", "DEPLOYMENT"],
        seedRefs: ["symbol:ingress-1"],
        excludeTargetIds: ["target-1"],
        maxResults: 10,
        correlationId: "corr-1",
      },
    },
    {
      name: "get_verified_profile",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getVerifiedProfile,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: {
          verifiedProfileId: "verified:vp-1",
          expectedVersion: "1.0.0",
          requiredFor: "CLASSIFICATION",
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        verifiedProfileId: "vp-1",
        expectedVersion: "1.0.0",
        requiredFor: "CLASSIFICATION",
        correlationId: "corr-1",
      },
    },
    {
      name: "get_classification_baseline",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getClassificationBaseline,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { profileRef: "verified:vp-1", maxResults: 10 },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { profileRef: "verified:vp-1", maxResults: 10 },
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
    {
      name: "get_gap_evidence_trace",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getGapEvidenceTrace,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { rowRef: "gap-row:row-1" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { rowRef: "gap-row:row-1" },
        actorId: "user-1",
        correlationId: "corr-1",
      },
    },
    {
      name: "propose_gap_remediation",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.proposeGapRemediation,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: {
          rowRef: "gap-row:row-1",
          templateId: "remediation:collect-evidence",
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: {
          rowRef: "gap-row:row-1",
          templateId: "remediation:collect-evidence",
        },
        actorId: "user-1",
        correlationId: "corr-1",
      },
    },
    {
      name: "validate_classification_proposal",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.validateClassificationProposal,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { proposalRef: "proposal:proposal-1" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { proposalRef: "proposal:proposal-1" },
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
    {
      name: "evaluate_gap_matrix",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.evaluateGapMatrix,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { matrixRef: "matrix:matrix-1" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { matrixRef: "matrix:matrix-1" },
        actorId: "user-1",
        correlationId: "corr-1",
      },
    },
    {
      name: "get_legal_corpus_readiness",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: {
          effectiveDate: "2026-08-13",
          pinnedCorpusVersionId: "corpus_abc123",
        },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        effectiveDateIso: "2026-08-13T00:00:00.000Z",
        pinnedCorpusVersionId: "abc123",
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
    {
      name: "retrieve_legal_basis",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.retrieveLegalBasis,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { legalQuery: "ai scoring for recruitment" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { legalQuery: "ai scoring for recruitment" },
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
    {
      name: "get_legal_rule_match",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.getLegalRuleMatch,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { ruleRef: "rule:rule-1", targetRef: "target:target-1" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { ruleRef: "rule:rule-1", targetRef: "target:target-1" },
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
    {
      name: "validate_citation_set",
      payload: {
        tool_name: AGENTIC_TOOL_NAMES.validateCitationSet,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: {},
        input: { citationSetRef: "citation-set:set-1" },
        correlationId: "corr-1",
      },
      expected: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        input: { citationSetRef: "citation-set:set-1" },
        actorId: "user-1",
        policyId: null,
        policyVersion: null,
        correlationId: "corr-1",
      },
    },
  ])(
    "maps $name dispatch payload to expected query shape",
    async ({ payload, expected }) => {
      const execute = jest
        .fn<(query?: unknown) => Promise<{ status: string }>>()
        .mockResolvedValue({ status: "READY" });
      const pythonWorkerRuntime = {
        requestTargetedReanalysis: jest.fn(),
        resumeWaitingRuns: jest.fn(),
      };
      const configService = {
        get: jest.fn().mockReturnValue(false),
      };
      const controller = new InternalAgenticToolDispatchController(
        {
          execute,
        } as never,
        pythonWorkerRuntime as never,
        configService as never,
      );

      await controller.dispatch(payload);

      expect(execute).toHaveBeenCalledTimes(1);
      const [queryArg] = execute.mock.calls[0] ?? [];
      const query = (queryArg ?? {}) as Record<string, unknown>;
      if ("effectiveDateIso" in expected) {
        expect((query.effectiveDate as Date).toISOString()).toBe(
          expected.effectiveDateIso,
        );
        const rest = { ...expected };
        delete (rest as { effectiveDateIso?: string }).effectiveDateIso;
        expect(query).toEqual(expect.objectContaining(rest));
        return;
      }
      expect(query).toEqual(expect.objectContaining(expected));
    },
  );

  it("routes request_targeted_reanalysis through the python worker runtime", async () => {
    const pythonWorkerRuntime = {
      requestTargetedReanalysis: jest
        .fn<
          (
            payload: Record<string, unknown>,
            correlationId: string,
          ) => Promise<Record<string, unknown>>
        >()
        .mockResolvedValue({ status: "READY", state: "QUEUED" }),
      resumeWaitingRuns: jest.fn(),
    };
    const controller = new InternalAgenticToolDispatchController(
      { execute: jest.fn() } as never,
      pythonWorkerRuntime as never,
      { get: jest.fn().mockReturnValue(false) } as never,
    );

    await controller.dispatch({
      tool_name: AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
      assessment_id: "assessment-1",
      organization_id: "org-1",
      user_id: "user-1",
      artifact_versions: {
        technicalEvidenceReportId: "ter_12345678",
      },
      input: {
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      correlationId: "corr-1",
    });

    expect(pythonWorkerRuntime.requestTargetedReanalysis).toHaveBeenCalledWith(
      {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        userId: "user-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      "corr-1",
    );
  });

  it("routes resume_waiting_runs through the python worker runtime", async () => {
    const pythonWorkerRuntime = {
      requestTargetedReanalysis: jest.fn(),
      resumeWaitingRuns: jest
        .fn<
          (
            payload: Record<string, unknown>,
            correlationId: string,
          ) => Promise<Record<string, unknown>>
        >()
        .mockResolvedValue({ status: "READY", resumedRunCount: 1 }),
    };
    const controller = new InternalAgenticToolDispatchController(
      { execute: jest.fn() } as never,
      pythonWorkerRuntime as never,
      { get: jest.fn().mockReturnValue(false) } as never,
    );

    await controller.dispatch({
      tool_name: AGENTIC_TOOL_NAMES.resumeWaitingRuns,
      assessment_id: "assessment-1",
      organization_id: "org-1",
      user_id: "user-1",
      artifact_versions: {
        corpusVersionId: "corpus-1",
      },
      input: {
        maxRuns: 10,
        idempotencyKey: "resume_waiting_runs_0001",
      },
      correlationId: "corr-1",
    });

    expect(pythonWorkerRuntime.resumeWaitingRuns).toHaveBeenCalledWith(
      {
        corpusVersionId: "corpus-1",
        maxRuns: 10,
        idempotencyKey: "resume_waiting_runs_0001",
      },
      "corr-1",
    );
  });
});
