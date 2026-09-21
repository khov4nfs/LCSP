import {
  ADMIN_ACCOUNT_FILTERS,
  ADMIN_ACCOUNT_QUERY_LIMITS,
  ADMIN_ACCOUNT_REFERENCE_TYPES,
  type AdminUserListResponse,
  type AdminUserSummary,
  type AuthAccountStatus,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AUTH_RECORD_TYPES } from "../../../../auth/infrastructure/persistence/auth-record.persistence.js";
import { ListAdminUsersQuery } from "./list-admin-users.query.js";

type ListRow = {
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRole;
  status: AuthAccountStatus;
  createdAt: Date;
  version: number;
  referenceType: typeof ADMIN_ACCOUNT_REFERENCE_TYPES.user;
};

/**
 * Handles administrative query to list users with pagination, text filtering,
 * role filtering, status filtering, and aggregated statistics (assessment counts, last active session).
 */
@QueryHandler(ListAdminUsersQuery)
export class ListAdminUsersHandler implements IQueryHandler<ListAdminUsersQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListAdminUsersQuery): Promise<AdminUserListResponse> {
    const page = query.params.page ?? 1;
    const pageSize =
      query.params.pageSize ??
      query.params.page_size ??
      ADMIN_ACCOUNT_QUERY_LIMITS.defaultPageSize;
    const rawSearchQuery = (query.params.query ?? query.params.q)?.trim() ?? "";
    const filterStatus =
      query.params.status === ADMIN_ACCOUNT_FILTERS.all
        ? undefined
        : (query.params.status as AuthAccountStatus | undefined);
    const filterRole =
      query.params.role === ADMIN_ACCOUNT_FILTERS.all
        ? undefined
        : (query.params.role as AuthUserRole | undefined);

    // Step 1: Base CTE query to project User entity into normalized account columns
    const userAccountsCte = Prisma.sql`
      SELECT "id", COALESCE(NULLIF("displayName", ''), "email") AS "fullName", "email",
             "role"::text AS "role", "accessStatus"::text AS "status", "createdAt", "accessVersion" AS "version", ${ADMIN_ACCOUNT_REFERENCE_TYPES.user}::text AS "referenceType"
      FROM "User"`;

    // Step 2: Escape SQL LIKE wildcard characters (%, _, \) to prevent query injection / unintended matching
    const escapedSearchQuery = rawSearchQuery.replace(
      /[\\%_]/g,
      (character) => `\\${character}`,
    );

    // Step 3: Build dynamic WHERE conditions
    const wherePredicates = [Prisma.sql`TRUE`];
    if (rawSearchQuery) {
      wherePredicates.push(
        Prisma.sql`("email" ILIKE ${`%${escapedSearchQuery}%`} OR "fullName" ILIKE ${`%${escapedSearchQuery}%`})`,
      );
    }
    if (filterStatus) {
      wherePredicates.push(Prisma.sql`"status" = ${filterStatus}`);
    }
    if (filterRole) {
      wherePredicates.push(Prisma.sql`"role" = ${filterRole}`);
    }
    const whereClause = Prisma.join(wherePredicates, " AND ");

    // Step 4: Execute query with RepeatableRead isolation to guarantee consistent snapshot
    return this.prisma.$transaction(
      async (transactionClient: Prisma.TransactionClient) => {
        // Query total count matching filter
        const totalCountRows = await transactionClient.$queryRaw<
          Array<{ count: bigint }>
        >(
          Prisma.sql`WITH accounts AS (${userAccountsCte}) SELECT count(*) AS count FROM accounts WHERE ${whereClause}`,
        );

        // Query paginated rows matching filter
        const userListRows = await transactionClient.$queryRaw<ListRow[]>(
          Prisma.sql`WITH accounts AS (${userAccountsCte}) SELECT * FROM accounts WHERE ${whereClause} ORDER BY "createdAt" DESC, "id" ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );

        const targetUserIds = userListRows.map((row) => row.id);

        // Step 5: Aggregate assessment counts and latest session activity in parallel for page rows
        const assessmentCountGroups = targetUserIds.length
          ? await transactionClient.assessment.groupBy({
              by: ["ownerId"],
              where: { ownerId: { in: targetUserIds } },
              _count: { _all: true },
            })
          : [];

        const latestSessionActivityGroups = targetUserIds.length
          ? await transactionClient.authRecord.groupBy({
              by: ["userId"],
              where: {
                userId: { in: targetUserIds },
                type: AUTH_RECORD_TYPES.session,
              },
              _max: { createdAt: true },
            })
          : [];

        // Step 6: Map raw database rows and aggregations to domain response DTO
        const users: AdminUserSummary[] = userListRows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          assessmentCount:
            assessmentCountGroups.find((entry) => entry.ownerId === row.id)
              ?._count._all ?? 0,
          lastActiveAt:
            latestSessionActivityGroups
              .find((entry) => entry.userId === row.id)
              ?._max.createdAt?.toISOString() ?? null,
        }));

        const totalCount = Number(totalCountRows[0]?.count ?? 0);
        return {
          users,
          totalCount,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
