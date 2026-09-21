import {
  ADMIN_ERROR_CODES,
  AUTH_ACCOUNT_STATUSES,
  ADMIN_ACCOUNT_REFERENCE_TYPES,
  USER_ACCESS_STATUSES,
  type AdminUserDetail,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AUTH_RECORD_TYPES } from "../../../../auth/infrastructure/persistence/auth-record.persistence.js";
import { GetAdminUserDetailQuery } from "./get-admin-user-detail.query.js";

const IDENTITY_SELECT = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  accessStatus: true,
  accessVersion: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fetches complete administrative detail view for a specific user.
 *
 * Gathers:
 * 1. User identity, role, access status, and optimistic version.
 * 2. Assessment usage count within the last 30 days.
 * 3. Most recent assessment creation timestamp.
 * 4. Most recent active session timestamp.
 */
export async function fetchAdminUserDetail(
  prismaClient: Prisma.TransactionClient | PrismaService,
  targetUserId: string,
  correlationId: string,
): Promise<AdminUserDetail> {
  const user = await prismaClient.user.findUnique({
    where: { id: targetUserId },
    select: IDENTITY_SELECT,
  });
  if (!user) {
    throw problemException(ADMIN_ERROR_CODES.userNotFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }

  const currentTime = new Date();
  const windowStart = new Date(currentTime.getTime() - THIRTY_DAYS_IN_MS);

  const [
    assessmentsIn30DaysCount,
    latestAssessmentRecord,
    latestSessionRecord,
  ] = await Promise.all([
    prismaClient.assessment.count({
      where: {
        ownerId: targetUserId,
        createdAt: { gte: windowStart, lte: currentTime },
      },
    }),
    prismaClient.assessment.aggregate({
      where: { ownerId: targetUserId },
      _max: { createdAt: true },
    }),
    prismaClient.authRecord.aggregate({
      where: { userId: targetUserId, type: AUTH_RECORD_TYPES.session },
      _max: { createdAt: true },
    }),
  ]);

  return {
    id: user.id,
    fullName: user.displayName || user.email,
    email: user.email,
    role: user.role,
    status:
      user.accessStatus === USER_ACCESS_STATUSES.suspended
        ? AUTH_ACCOUNT_STATUSES.suspended
        : AUTH_ACCOUNT_STATUSES.active,
    referenceType: ADMIN_ACCOUNT_REFERENCE_TYPES.user,
    version: user.accessVersion,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: latestSessionRecord._max.createdAt?.toISOString() ?? null,
    usageSummary: {
      assessments30d: assessmentsIn30DaysCount,
      lastAssessmentAt:
        latestAssessmentRecord._max.createdAt?.toISOString() ?? null,
      creditSpend30d: null,
      openFindingsCount: null,
    },
  };
}

/**
 * CQRS Query Handler for fetching administrative user details.
 */
@QueryHandler(GetAdminUserDetailQuery)
export class GetAdminUserDetailHandler implements IQueryHandler<GetAdminUserDetailQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetAdminUserDetailQuery): Promise<AdminUserDetail> {
    return fetchAdminUserDetail(this.prisma, query.id, query.correlationId);
  }
}
