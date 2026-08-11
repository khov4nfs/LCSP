import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  ARTIFACT_CHAIN_INTEGRITY,
  ARTIFACT_CHAIN_STAGES,
  type ArtifactChainStage,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  fromPrismaEvidenceAcceptanceStatus,
  fromPrismaVerifiedProfileStatus,
  fromPrismaWizardStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  ArtifactChainLink,
  ArtifactChainLimitation,
  ArtifactChainToolResponse,
} from "../../contracts/reconciliation/artifact-chain.contract.js";
import { GetArtifactChainQuery } from "./get-artifact-chain.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:artifact-chain-v1";

@QueryHandler(GetArtifactChainQuery)
export class GetArtifactChainHandler implements IQueryHandler<
  GetArtifactChainQuery,
  ArtifactChainToolResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetArtifactChainQuery,
  ): Promise<ArtifactChainToolResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId, organizationId: query.organizationId },
      select: { id: true },
    });

    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const [report, wizardProfile] = await Promise.all([
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          assessmentId: assessment.id,
          organizationId: query.organizationId,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, schemaVersion: true, status: true },
      }),
      this.prisma.wizardProfile.findUnique({
        where: { assessmentId: assessment.id },
        select: { id: true, version: true, status: true },
      }),
    ]);

    const profile = report
      ? await this.prisma.technicalProfile.findFirst({
          where: {
            evidenceReportId: report.id,
            assessmentId: assessment.id,
            organizationId: query.organizationId,
          },
          select: { id: true, schemaVersion: true, status: true },
        })
      : null;
    const flow = profile
      ? await this.prisma.aIUsageFlow.findFirst({
          where: {
            technicalProfileId: profile.id,
            assessmentId: assessment.id,
            organizationId: query.organizationId,
          },
          select: { id: true, schemaVersion: true, status: true },
        })
      : null;
    const [conflicts, verifiedProfile] = flow
      ? await Promise.all([
          this.prisma.conflictRecord.findMany({
            where: {
              aiUsageFlowId: flow.id,
              assessmentId: assessment.id,
              organizationId: query.organizationId,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true },
          }),
          this.prisma.verifiedProfile.findFirst({
            where: {
              aiUsageFlowId: flow.id,
              assessmentId: assessment.id,
              organizationId: query.organizationId,
            },
            select: { id: true, schemaVersion: true, status: true },
          }),
        ])
      : [[], null];

    const links: ArtifactChainLink[] = [];
    const presentStages = new Set<ArtifactChainStage>();
    const add = (
      stage: ArtifactChainStage,
      artifactRef: string,
      version: string,
      status: string,
    ) => {
      presentStages.add(stage);
      links.push({
        stage,
        artifact_ref: artifactRef,
        version,
        status,
        provenance_ref: `provenance:${artifactRef}`,
      });
    };

    if (report)
      add(
        ARTIFACT_CHAIN_STAGES.technicalEvidence,
        `ter:${report.id}`,
        report.schemaVersion,
        fromPrismaEvidenceAcceptanceStatus(report.status),
      );
    if (wizardProfile)
      add(
        ARTIFACT_CHAIN_STAGES.wizardProfile,
        `wizard:${wizardProfile.id}`,
        String(wizardProfile.version),
        fromPrismaWizardStatus(wizardProfile.status),
      );
    if (flow)
      add(
        ARTIFACT_CHAIN_STAGES.aiUsageFlow,
        `flow:${flow.id}`,
        flow.schemaVersion,
        fromPrismaEvidenceAcceptanceStatus(flow.status),
      );
    for (const conflict of conflicts)
      add(
        ARTIFACT_CHAIN_STAGES.conflict,
        `conflict:${conflict.id}`,
        "1",
        conflict.status,
      );
    if (verifiedProfile)
      add(
        ARTIFACT_CHAIN_STAGES.verifiedProfile,
        `verified:${verifiedProfile.id}`,
        verifiedProfile.schemaVersion,
        fromPrismaVerifiedProfileStatus(verifiedProfile.status),
      );

    const requiredStages =
      query.requiredStages.length > 0
        ? query.requiredStages
        : [
            ARTIFACT_CHAIN_STAGES.technicalEvidence,
            ARTIFACT_CHAIN_STAGES.aiUsageFlow,
            ARTIFACT_CHAIN_STAGES.verifiedProfile,
          ];
    const limitations: ArtifactChainLimitation[] = requiredStages
      .filter((stage) => !presentStages.has(stage))
      .map((stage) => ({ stage, reason: "ARTIFACT_LINK_MISSING" }));
    const integrity =
      limitations.length === 0
        ? ARTIFACT_CHAIN_INTEGRITY.valid
        : ARTIFACT_CHAIN_INTEGRITY.limited;
    const coverageState =
      limitations.length === 0
        ? AGENTIC_TOOL_COVERAGE_STATES.sufficient
        : AGENTIC_TOOL_COVERAGE_STATES.limited;

    const response: ArtifactChainToolResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getArtifactChain,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlation_id: query.correlationId,
      artifact_versions: { assessment_id: assessment.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageState,
      evidence_refs: links.map((link) => link.artifact_ref),
      limitations,
      result: { links, missing_stages: limitations, integrity },
    };

    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.artifactChainRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: assessment.id,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessment.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        artifactRefs: response.evidence_refs,
        exactVersions: query.exactVersions,
      },
    });

    return response;
  }
}
