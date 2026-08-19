import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { SCAN_EVENT_TYPES } from "@lcsp/contracts/scan";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { fromPrismaVerifiedProfileStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ListVerifiedProfilesQuery } from "./list-verified-profiles.query.js";

const MAX_HISTORY_RESULTS = 100;

type VerifiedProfileHistoryItem = {
  id: string;
  version: number;
  aiUsageFlowId: string;
  wizardProfileId: string | null;
  technicalEvidenceReportId: string | null;
  reconciliationDecisionRefs: unknown;
  status: string;
  approvedAt: string | null;
  approvedById: string | null;
  createdAt: string;
  gatesPassedAt: unknown;
};

type VerifiedProfileHistoryResponse = {
  profiles: VerifiedProfileHistoryItem[];
  totalCount: number;
};

@QueryHandler(ListVerifiedProfilesQuery)
export class ListVerifiedProfilesHandler implements IQueryHandler<
  ListVerifiedProfilesQuery,
  VerifiedProfileHistoryResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: ListVerifiedProfilesQuery,
  ): Promise<VerifiedProfileHistoryResponse> {
    const [profiles, totalCount] = await Promise.all([
      this.prisma.verifiedProfile.findMany({
        where: {
          assessmentId: query.assessmentId,
          organizationId: query.organizationId,
        },
        select: {
          id: true,
          version: true,
          aiUsageFlowId: true,
          wizardProfileId: true,
          technicalEvidenceReportId: true,
          reconciliationDecisionRefs: true,
          status: true,
          approvedAt: true,
          approvedById: true,
          createdAt: true,
          gatesPassedAt: true,
        },
        orderBy: { version: "asc" },
        take: MAX_HISTORY_RESULTS,
      }),
      this.prisma.verifiedProfile.count({
        where: {
          assessmentId: query.assessmentId,
          organizationId: query.organizationId,
        },
      }),
    ]);
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.verifiedProfileHistoryReadAudit,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
      resourceId: query.assessmentId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: { returnedCount: profiles.length, totalCount },
    });
    return {
      profiles: profiles.map((p) => ({
        id: p.id,
        version: p.version,
        aiUsageFlowId: p.aiUsageFlowId,
        wizardProfileId: p.wizardProfileId,
        technicalEvidenceReportId: p.technicalEvidenceReportId,
        reconciliationDecisionRefs: p.reconciliationDecisionRefs,
        status: fromPrismaVerifiedProfileStatus(p.status),
        approvedAt: p.approvedAt?.toISOString() ?? null,
        approvedById: p.approvedById ?? null,
        createdAt: p.createdAt.toISOString(),
        gatesPassedAt: p.gatesPassedAt,
      })),
      totalCount,
    };
  }
}
