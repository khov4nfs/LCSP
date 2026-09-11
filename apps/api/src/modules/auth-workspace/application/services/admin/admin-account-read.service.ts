import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ADMIN_ACCOUNT_REFERENCE_TYPES as R,
  ADMIN_ERROR_CODES,
  ACCOUNT_INVITATION_STATUSES,
  AUTH_ACCOUNT_STATUSES,
  USER_ACCESS_STATUSES,
  type AdminUserDetail,
  type AdminUserListResponse,
  type AdminUserSummary,
  type AuthUserRole,
  type AuthAccountStatus,
} from "@lcsp/contracts/auth";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AUTH_RECORD_TYPES } from "../../../infrastructure/persistence/auth-record.persistence.js";
import { parseListQuery } from "./admin-account.validation.js";

const IDENTITY_SELECT = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  accessStatus: true,
  accessVersion: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
type ListRow = {
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRole;
  status: AuthAccountStatus;
  createdAt: Date;
  version: number;
  referenceType: typeof R.user | typeof R.invitation;
};

@Injectable()
export class AdminAccountReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    raw: Record<string, unknown>,
    correlationId: string,
  ): Promise<AdminUserListResponse> {
    const q = parseListQuery(raw, correlationId);
    const now = new Date();
    // Parameterized UNION performs sorting and pagination in Postgres, including
    // invitation records. No full user base or credential columns are loaded.
    const accounts = Prisma.sql`
      SELECT "id", COALESCE(NULLIF("displayName", ''), "email") AS "fullName", "email",
             "role"::text AS "role", "accessStatus"::text AS "status", "createdAt", "accessVersion" AS "version", ${R.user}::text AS "referenceType"
      FROM "User"
      UNION ALL
      SELECT 'invitation:' || i."id", i."displayName", i."email", i."role"::text,
             ${AUTH_ACCOUNT_STATUSES.invited}::text, i."createdAt", i."version", ${R.invitation}::text
      FROM "AccountInvitation" i
      WHERE i."status" = ${ACCOUNT_INVITATION_STATUSES.pending}::"AccountInvitationStatus" AND i."expiresAt" > ${now}
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u."email") = lower(i."email"))`;
    const escaped = q.query.replace(/[\\%_]/g, (character) => `\\${character}`);
    const predicates = [Prisma.sql`TRUE`];
    if (q.query)
      predicates.push(
        Prisma.sql`("email" ILIKE ${`%${escaped}%`} OR "fullName" ILIKE ${`%${escaped}%`})`,
      );
    if (q.status) predicates.push(Prisma.sql`"status" = ${q.status}`);
    if (q.role) predicates.push(Prisma.sql`"role" = ${q.role}`);
    const filter = Prisma.join(predicates, " AND ");
    return this.prisma.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`WITH accounts AS (${accounts}) SELECT count(*) AS count FROM accounts WHERE ${filter}`,
        );
        const rows = await tx.$queryRaw<ListRow[]>(
          Prisma.sql`WITH accounts AS (${accounts}) SELECT * FROM accounts WHERE ${filter} ORDER BY "createdAt" DESC, "id" ASC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
        );
        const ids = rows
          .filter((row) => row.referenceType === R.user)
          .map((row) => row.id);
        const assessmentCounts = ids.length
          ? await tx.assessment.groupBy({
              by: ["ownerId"],
              where: { ownerId: { in: ids } },
              _count: { _all: true },
            })
          : [];
        const activity = ids.length
          ? await tx.authRecord.groupBy({
              by: ["userId"],
              where: { userId: { in: ids }, type: AUTH_RECORD_TYPES.session },
              _max: { createdAt: true },
            })
          : [];
        const users: AdminUserSummary[] = rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          assessmentCount:
            assessmentCounts.find((entry) => entry.ownerId === row.id)?._count
              ._all ?? 0,
          lastActiveAt:
            activity
              .find((entry) => entry.userId === row.id)
              ?._max.createdAt?.toISOString() ?? null,
        }));
        const totalCount = Number(counts[0]?.count ?? 0);
        return {
          users,
          totalCount,
          page: q.page,
          pageSize: q.pageSize,
          totalPages: Math.max(1, Math.ceil(totalCount / q.pageSize)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(
    id: string,
    correlationId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<AdminUserDetail> {
    if (id.startsWith("invitation:")) {
      const invitation = await client.accountInvitation.findUnique({
        where: { id: id.slice(11) },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          deliveryStatus: true,
          version: true,
        },
      });
      if (
        !invitation ||
        invitation.status !== ACCOUNT_INVITATION_STATUSES.pending ||
        invitation.expiresAt <= new Date()
      )
        return this.notFound(correlationId);
      return {
        id,
        fullName: invitation.displayName,
        email: invitation.email,
        role: invitation.role,
        status: AUTH_ACCOUNT_STATUSES.invited,
        referenceType: R.invitation,
        version: invitation.version,
        createdAt: invitation.createdAt.toISOString(),
        lastActiveAt: null,
        invitationExpiresAt: invitation.expiresAt.toISOString(),
        deliveryStatus: invitation.deliveryStatus,
        usageSummary: {
          assessments30d: 0,
          lastAssessmentAt: null,
          creditSpend30d: null,
          openFindingsCount: null,
        },
      };
    }
    const user = await client.user.findUnique({
      where: { id },
      select: IDENTITY_SELECT,
    });
    if (!user) return this.notFound(correlationId);
    const now = new Date();
    const [assessments30d, lastAssessment, activity] = await Promise.all([
      client.assessment.count({
        where: {
          ownerId: id,
          createdAt: { gte: new Date(now.getTime() - WINDOW_MS), lte: now },
        },
      }),
      client.assessment.aggregate({
        where: { ownerId: id },
        _max: { createdAt: true },
      }),
      client.authRecord.aggregate({
        where: { userId: id, type: AUTH_RECORD_TYPES.session },
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
      referenceType: R.user,
      version: user.accessVersion,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: activity._max.createdAt?.toISOString() ?? null,
      usageSummary: {
        assessments30d,
        lastAssessmentAt: lastAssessment._max.createdAt?.toISOString() ?? null,
        creditSpend30d: null,
        openFindingsCount: null,
      },
    };
  }
  private notFound(correlationId: string): never {
    throw problemException(ADMIN_ERROR_CODES.userNotFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}
