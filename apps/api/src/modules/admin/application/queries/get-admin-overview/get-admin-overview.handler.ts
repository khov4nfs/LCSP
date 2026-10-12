import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ADMIN_OVERVIEW_ACTION_KEYS,
  ADMIN_OVERVIEW_PERIODS,
  AUTH_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
  type AdminLegalSourceStatusSummary,
  type AdminOverviewAccountDistribution,
  type AdminOverviewActionKey,
  type AdminOverviewActivityPoint,
  type AdminOverviewPeriod,
  type AdminOverviewStats,
  type AdminRecentActivityItem,
} from "@lcsp/contracts/auth";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  LEGAL_SOURCE_EVENT_TYPES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";

import { isRecord } from "@lcsp/contracts/shared";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalSourceLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { GetAdminOverviewQuery } from "./get-admin-overview.query.js";

/**
 * Audit event types that are relevant for the administrative overview recent activity feed.
 */
const ADMIN_AUDIT_EVENT_TYPES_LIST = [
  AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended,
  AUTH_AUDIT_EVENT_TYPES.authAdminUserRestored,
  AUTH_AUDIT_EVENT_TYPES.authAdminInvitationCreated,
  LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated,
];

/**
 * Handles administrative query to aggregate system-wide overview statistics:
 * - User population and growth within selected period (7d, 30d, 90d).
 * - Assessment volumes and completion metrics.
 * - Legal legalSource versioning lifecycle status.
 * - Assessment activity timeline distribution.
 * - Recent administrative actions and audit history.
 */
@QueryHandler(GetAdminOverviewQuery)
export class GetAdminOverviewHandler implements IQueryHandler<GetAdminOverviewQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetAdminOverviewQuery,
    currentTime: Date = new Date(),
  ): Promise<AdminOverviewStats> {
    const period = this.normalizePeriod(query.period);
    const periodDays =
      period === ADMIN_OVERVIEW_PERIODS.p7d
        ? 7
        : period === ADMIN_OVERVIEW_PERIODS.p90d
          ? 90
          : 30;

    const windowStart = new Date(
      currentTime.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );

    // Fetch all summary counters and records in parallel
    const [
      activeUsersCount,
      suspendedUsersCount,
      periodNewUsersCount,
      totalAssessmentsCount,
      periodCompletedAssessmentsCount,
      activatedLegalSource,
      draftLegalSource,
      periodAssessments,
      recentAuditEvents,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { accessStatus: USER_ACCESS_STATUSES.active },
      }),
      this.prisma.user.count({
        where: { accessStatus: USER_ACCESS_STATUSES.suspended },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: windowStart, lte: currentTime } },
      }),
      this.prisma.assessment.count(),
      this.prisma.assessment.count({
        where: {
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          updatedAt: { gte: windowStart, lte: currentTime },
        },
      }),
      this.prisma.legalSourceVersion.findFirst({
        where: {
          status: toPrismaLegalSourceLifecycleStatus(
            LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
          ),
        },
        include: { _count: { select: { documents: true } } },
        orderBy: { activatedAt: "desc" },
      }),
      this.prisma.legalSourceVersion.findFirst({
        where: {
          status: toPrismaLegalSourceLifecycleStatus(
            LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
          ),
        },
        include: { _count: { select: { documents: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.assessment.findMany({
        where: {
          OR: [
            { createdAt: { gte: windowStart, lte: currentTime } },
            {
              lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
              updatedAt: { gte: windowStart, lte: currentTime },
            },
          ],
        },
        select: {
          createdAt: true,
          lifecycleState: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          eventType: { in: ADMIN_AUDIT_EVENT_TYPES_LIST },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    // Total users = active + suspended
    const totalUsersCount = activeUsersCount + suspendedUsersCount;
    const activePercentage =
      totalUsersCount > 0
        ? Math.round((activeUsersCount / totalUsersCount) * 1000) / 10
        : 0;

    // Build timeline buckets for assessment activity
    const activityData = this.buildActivityData(
      periodDays,
      windowStart,
      currentTime,
      periodAssessments,
    );

    // Sanitize recent audit events with admin actor metadata
    const recentActivity = await this.sanitizeRecentActivity(recentAuditEvents);

    // Build legal legalSource summary
    const legalSourceStatus: AdminLegalSourceStatusSummary = {
      current: activatedLegalSource
        ? {
            version: activatedLegalSource.version,
            sourceCount: activatedLegalSource._count.documents,
            ruleCount: null,
            activatedAt:
              activatedLegalSource.activatedAt?.toISOString() ?? null,
          }
        : null,
      draft: draftLegalSource
        ? {
            version: draftLegalSource.version,
            sourceCount: draftLegalSource._count.documents,
            ruleCount: null,
            createdAt: draftLegalSource.createdAt.toISOString(),
          }
        : null,
    };

    const accountDistribution: AdminOverviewAccountDistribution = {
      activeCount: activeUsersCount,
      invitedCount: 0,
      suspendedCount: suspendedUsersCount,
      deactivatedCount: 0,
      totalCount: totalUsersCount,
    };

    return {
      period,
      periodDays,
      summary: {
        totalUsers: {
          count: totalUsersCount,
          periodChange: periodNewUsersCount,
        },
        activeUsers: {
          count: activeUsersCount,
          percentageOfTotal: activePercentage,
        },
        assessments: {
          totalCount: totalAssessmentsCount,
          periodCompletedCount: periodCompletedAssessmentsCount,
        },
        currentLegalSource: {
          version: activatedLegalSource?.version ?? null,
          sourceCount: activatedLegalSource?._count.documents ?? 0,
          ruleCount: null,
        },
      },
      assessmentActivity: activityData,
      accountDistribution,
      recentActivity,
      legalSourceStatus,
    };
  }

  private normalizePeriod(rawPeriod?: string): AdminOverviewPeriod {
    if (rawPeriod === ADMIN_OVERVIEW_PERIODS.p7d)
      return ADMIN_OVERVIEW_PERIODS.p7d;
    if (rawPeriod === ADMIN_OVERVIEW_PERIODS.p90d)
      return ADMIN_OVERVIEW_PERIODS.p90d;
    return ADMIN_OVERVIEW_PERIODS.p30d;
  }

  /**
   * Generates time-bucketed activity data points (up to 14 bars) for the assessment graph.
   */
  private buildActivityData(
    periodDays: number,
    windowStart: Date,
    currentTime: Date,
    assessments: Array<{
      createdAt: Date;
      lifecycleState: string | null;
      updatedAt: Date;
    }>,
  ) {
    const barCount = periodDays <= 14 ? periodDays : 14;
    const intervalMs =
      (currentTime.getTime() - windowStart.getTime()) / barCount;

    const points: AdminOverviewActivityPoint[] = [];

    for (let i = 0; i < barCount; i++) {
      const bucketStart = new Date(windowStart.getTime() + i * intervalMs);
      const bucketEnd = new Date(windowStart.getTime() + (i + 1) * intervalMs);
      const dateKey = bucketStart.toISOString().slice(0, 10);

      let startedCount = 0;
      let completedCount = 0;

      for (const assessment of assessments) {
        if (
          assessment.createdAt >= bucketStart &&
          assessment.createdAt < bucketEnd
        ) {
          startedCount++;
        }
        if (
          assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
          assessment.updatedAt >= bucketStart &&
          assessment.updatedAt < bucketEnd
        ) {
          completedCount++;
        }
      }

      points.push({
        date: dateKey,
        timestamp: bucketStart.toISOString(),
        startedCount,
        completedCount,
      });
    }

    const totalStarted = assessments.filter(
      (assessment) =>
        assessment.createdAt >= windowStart &&
        assessment.createdAt <= currentTime,
    ).length;

    const totalCompleted = assessments.filter(
      (assessment) =>
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
        assessment.updatedAt >= windowStart &&
        assessment.updatedAt <= currentTime,
    ).length;

    return {
      points,
      totalStarted,
      totalCompleted,
      startDate: windowStart.toISOString(),
      endDate: currentTime.toISOString(),
    };
  }

  /**
   * Enriches raw audit events with actor names and structured targets for the overview feed.
   */
  private async sanitizeRecentActivity(
    events: Array<{
      id: string;
      eventType: string;
      actorId: string | null;
      createdAt: Date;
      payload: unknown;
    }>,
  ): Promise<AdminRecentActivityItem[]> {
    if (events.length === 0) return [];

    const actorIds = [
      ...new Set(
        events
          .map((event) => event.actorId)
          .filter((actorId): actorId is string => Boolean(actorId)),
      ),
    ];

    const users: Array<{
      id: string;
      email: string;
      displayName: string | null;
    }> = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, displayName: true },
        })
      : [];

    const userMap = new Map(users.map((user) => [user.id, user]));

    return events.map((event) => {
      const user = event.actorId ? userMap.get(event.actorId) : undefined;
      const adminEmail = user?.email ?? null;
      const adminName = user?.displayName ?? null;
      const payload = isRecord(event.payload) ? event.payload : {};

      const { actionKey, target } = this.resolveActionAndTarget(
        event.eventType,
        payload,
      );

      return {
        id: event.id,
        eventType: event.eventType,
        actionKey,
        occurredAt: event.createdAt.toISOString(),
        adminEmail,
        adminName,
        target,
      };
    });
  }

  /**
   * Resolves display action key and target descriptor from audit event type and payload.
   */
  private resolveActionAndTarget(
    eventType: string,
    payload: Record<string, unknown>,
  ): { actionKey: AdminOverviewActionKey; target: string | null } {
    const targetUserId =
      typeof payload.targetUserId === "string" && payload.targetUserId.trim()
        ? payload.targetUserId.trim()
        : null;
    const email =
      typeof payload.email === "string" && payload.email.trim()
        ? payload.email.trim()
        : null;
    const legalSourceVersionRef =
      typeof payload.legalSourceVersionRef === "string" &&
      payload.legalSourceVersionRef.trim()
        ? payload.legalSourceVersionRef.trim()
        : null;

    const actualTarget = email || legalSourceVersionRef || targetUserId;

    if (eventType === AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended) {
      return {
        actionKey: ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount,
        target: actualTarget,
      };
    }
    if (eventType === AUTH_AUDIT_EVENT_TYPES.authAdminUserRestored) {
      return {
        actionKey: ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount,
        target: actualTarget,
      };
    }
    if (eventType === AUTH_AUDIT_EVENT_TYPES.authAdminInvitationCreated) {
      return {
        actionKey: ADMIN_OVERVIEW_ACTION_KEYS.invitedUser,
        target: actualTarget,
      };
    }
    if (eventType === LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated) {
      return {
        actionKey: ADMIN_OVERVIEW_ACTION_KEYS.activatedLegalSource,
        target: actualTarget,
      };
    }

    return {
      actionKey: ADMIN_OVERVIEW_ACTION_KEYS.generalAction,
      target: actualTarget,
    };
  }
}
