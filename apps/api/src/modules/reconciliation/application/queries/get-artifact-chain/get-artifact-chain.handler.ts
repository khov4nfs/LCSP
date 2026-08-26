import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  ARTIFACT_CHAIN_INTEGRITY,
  ARTIFACT_CHAIN_STAGES,
  type ArtifactChainStage,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type {
  EvidenceAcceptanceStatus as PrismaEvidenceAcceptanceStatus,
  VerifiedProfileStatus as PrismaVerifiedProfileStatus,
} from "@prisma/client";
import {
  fromPrismaEvidenceAcceptanceStatus,
  fromPrismaVerifiedProfileStatus,
  fromPrismaWizardStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  ArtifactChainLimitation,
  ArtifactChainLink,
  ArtifactChainToolResponse,
} from "../../contracts/reconciliation/artifact-chain.contract.js";
import { GetArtifactChainQuery } from "./get-artifact-chain.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:artifact-chain-v1";

type ArtifactChainReportRecord = {
  id: string;
  schemaVersion: string;
  status: PrismaEvidenceAcceptanceStatus;
};

type ArtifactChainFlowRecord = {
  id: string;
  schemaVersion: string;
  status: PrismaEvidenceAcceptanceStatus;
  technicalProfileId: string;
};

type ArtifactChainConflictRecord = {
  id: string;
  status: string;
};

type ArtifactChainVerifiedProfileRecord = {
  id: string;
  schemaVersion: string;
  status: PrismaVerifiedProfileStatus;
  wizardProfileId: string | null;
  aiUsageFlowId: string;
};

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
      where: { id: query.assessmentId },
      select: { id: true },
    });

    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const chain = query.artifactRef
      ? await this.resolveExactChainFromArtifactRef(
          assessment.id,
          query.artifactRef,
          query.correlationId,
        )
      : await this.resolveLatestChain(assessment.id);
    const { report, wizardProfile, flow, conflicts, verifiedProfile } = chain;

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
      correlationId: query.correlationId,
      artifact_versions: { assessment_id: assessment.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageState,
      evidence_refs: links.map((link) => link.artifact_ref),
      limitations,
      result: {
        anchor_artifact_ref: query.artifactRef,
        links,
        missing_stages: limitations,
        integrity,
      },
    };

    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.artifactChainRead,
      actorId: null,
      assessmentId: assessment.id,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessment.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        artifactRefs: response.evidence_refs,
        anchorArtifactRef: query.artifactRef,
        exactVersions: query.exactVersions,
      },
    });

    return response;
  }

  private async resolveLatestChain(assessmentId: string) {
    const [report, wizardProfile] = await Promise.all([
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          assessmentId,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, schemaVersion: true, status: true },
      }),
      this.prisma.wizardProfile.findUnique({
        where: { assessmentId },
        select: { id: true, version: true, status: true },
      }),
    ]);

    const profile = report
      ? await this.prisma.technicalProfile.findFirst({
          where: {
            evidenceReportId: report.id,
            assessmentId,
          },
          select: { id: true },
        })
      : null;
    const flow = profile
      ? await this.prisma.aIUsageFlow.findFirst({
          where: {
            technicalProfileId: profile.id,
            assessmentId,
          },
          select: {
            id: true,
            schemaVersion: true,
            status: true,
            technicalProfileId: true,
          },
        })
      : null;
    const [conflicts, verifiedProfile] = flow
      ? await Promise.all([
          this.prisma.conflictRecord.findMany({
            where: {
              aiUsageFlowId: flow.id,
              assessmentId,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true },
          }),
          this.prisma.verifiedProfile.findFirst({
            where: {
              aiUsageFlowId: flow.id,
              assessmentId,
            },
            select: {
              id: true,
              schemaVersion: true,
              status: true,
              wizardProfileId: true,
              aiUsageFlowId: true,
            },
          }),
        ])
      : [[], null];

    return { report, wizardProfile, flow, conflicts, verifiedProfile };
  }

  private async resolveExactChainFromArtifactRef(
    assessmentId: string,
    artifactRef: string,
    correlationId: string,
  ) {
    const anchor = parseArtifactRef(artifactRef, correlationId);

    let report: ArtifactChainReportRecord | null = null;
    let flow: ArtifactChainFlowRecord | null = null;
    let conflicts: ArtifactChainConflictRecord[] = [];
    let verifiedProfile: ArtifactChainVerifiedProfileRecord | null = null;

    if (anchor.kind === "ter") {
      report = await this.prisma.technicalEvidenceReport.findFirst({
        where: { id: anchor.id, assessmentId },
        select: { id: true, schemaVersion: true, status: true },
      });
      if (!report) {
        throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      const profile = await this.prisma.technicalProfile.findFirst({
        where: { evidenceReportId: report.id, assessmentId },
        select: { id: true },
      });
      flow = profile
        ? await this.prisma.aIUsageFlow.findFirst({
            where: {
              technicalProfileId: profile.id,
              assessmentId,
            },
            select: {
              id: true,
              schemaVersion: true,
              status: true,
              technicalProfileId: true,
            },
          })
        : null;
    } else if (anchor.kind === "flow") {
      flow = await this.prisma.aIUsageFlow.findFirst({
        where: { id: anchor.id, assessmentId },
        select: {
          id: true,
          schemaVersion: true,
          status: true,
          technicalProfileId: true,
        },
      });
      if (!flow) {
        throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      const profile = await this.prisma.technicalProfile.findFirst({
        where: { id: flow.technicalProfileId, assessmentId },
        select: { evidenceReportId: true },
      });
      report = profile
        ? await this.prisma.technicalEvidenceReport.findFirst({
            where: {
              id: profile.evidenceReportId,
              assessmentId,
            },
            select: { id: true, schemaVersion: true, status: true },
          })
        : null;
    } else if (anchor.kind === "conflict") {
      const conflict = await this.prisma.conflictRecord.findFirst({
        where: { id: anchor.id, assessmentId },
        select: { id: true, status: true, aiUsageFlowId: true },
      });
      if (!conflict) {
        throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      conflicts = [{ id: conflict.id, status: conflict.status }];
      flow = await this.prisma.aIUsageFlow.findFirst({
        where: { id: conflict.aiUsageFlowId, assessmentId },
        select: {
          id: true,
          schemaVersion: true,
          status: true,
          technicalProfileId: true,
        },
      });
      if (flow) {
        const profile = await this.prisma.technicalProfile.findFirst({
          where: { id: flow.technicalProfileId, assessmentId },
          select: { evidenceReportId: true },
        });
        report = profile
          ? await this.prisma.technicalEvidenceReport.findFirst({
              where: {
                id: profile.evidenceReportId,
                assessmentId,
              },
              select: { id: true, schemaVersion: true, status: true },
            })
          : null;
      }
    } else if (anchor.kind === "verified") {
      verifiedProfile = await this.prisma.verifiedProfile.findFirst({
        where: { id: anchor.id, assessmentId },
        select: {
          id: true,
          schemaVersion: true,
          status: true,
          aiUsageFlowId: true,
          wizardProfileId: true,
        },
      });
      if (!verifiedProfile) {
        throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }
      flow = await this.prisma.aIUsageFlow.findFirst({
        where: {
          id: verifiedProfile.aiUsageFlowId,
          assessmentId,
        },
        select: {
          id: true,
          schemaVersion: true,
          status: true,
          technicalProfileId: true,
        },
      });
      if (flow) {
        const profile = await this.prisma.technicalProfile.findFirst({
          where: { id: flow.technicalProfileId, assessmentId },
          select: { evidenceReportId: true },
        });
        report = profile
          ? await this.prisma.technicalEvidenceReport.findFirst({
              where: {
                id: profile.evidenceReportId,
                assessmentId,
              },
              select: { id: true, schemaVersion: true, status: true },
            })
          : null;
      }
    }

    if (flow && conflicts.length === 0) {
      conflicts = await this.prisma.conflictRecord.findMany({
        where: { aiUsageFlowId: flow.id, assessmentId },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true },
      });
    }

    if (flow && !verifiedProfile) {
      verifiedProfile = await this.prisma.verifiedProfile.findFirst({
        where: { aiUsageFlowId: flow.id, assessmentId },
        select: {
          id: true,
          schemaVersion: true,
          status: true,
          wizardProfileId: true,
          aiUsageFlowId: true,
        },
      });
    }

    const wizardProfile = verifiedProfile?.wizardProfileId
      ? await this.prisma.wizardProfile.findFirst({
          where: { id: verifiedProfile.wizardProfileId, assessmentId },
          select: { id: true, version: true, status: true },
        })
      : null;

    return { report, wizardProfile, flow, conflicts, verifiedProfile };
  }
}

function parseArtifactRef(artifactRef: string, correlationId: string) {
  const match =
    /^(?<kind>ter|flow|conflict|verified):(?<id>[A-Za-z0-9_-]{1,160})$/u.exec(
      artifactRef,
    );
  if (!match?.groups?.kind || !match.groups.id) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }
  return {
    kind: match.groups.kind as "ter" | "flow" | "conflict" | "verified",
    id: match.groups.id,
  };
}
