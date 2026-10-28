import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import {
  MODEL_ATTEMPT_STATUSES,
  REFERENCE_COST_STATUSES,
  USAGE_ANALYTICS_DIMENSIONS,
  USAGE_TOKEN_FIELDS,
  attodollarsToUsd,
  referenceCostSnapshotSchema,
  type AdminUsageAnalytics,
  type UsageAnalyticsSummary,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetAdminUsageQuery } from "./get-admin-usage.query.js";

type Aggregate = {
  dimension: string;
  key: string;
  summary: UsageAnalyticsSummary & { costAttodollars: string };
};
@QueryHandler(GetAdminUsageQuery)
export class GetAdminUsageHandler implements IQueryHandler<GetAdminUsageQuery> {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Business purpose: Provide Admin usage analytics and a paginated invocation ledger without
   *   hiding unknown usage or incomplete reference costs.
   *
   * Business rules:
   * - Apply the validated filters to both the overview and detail rows; default the inclusive
   *   time range to the last 30 days.
   * - Compute overview/group totals over all matching receipts, independently of pagination,
   *   and retain unknown-token and incomplete-cost counts.
   * - Official reference estimates are informational and do not establish provider charges or
   *   financial settlement.
   *
   * Execution flow:
   * 1. Build parameter-bound filters and the predefined token/dimension aggregations.
   * 2. Read all aggregates and the requested receipt page in one repeatable-read transaction.
   * 3. Project known token sums, unknown counts, reference estimates and pagination metadata.
   *
   * Failure cases:
   * - Database failures, invalid stored reference-cost snapshots and unsupported date/number
   *   representations propagate; an empty result yields a zero-count summary.
   *
   * Side effects:
   * - Read-only database transaction; no invocation, wallet, reservation or charge is changed.
   */
  async execute({
    filters: f,
  }: GetAdminUsageQuery): Promise<AdminUsageAnalytics> {
    const to = new Date(f.to ?? Date.now());
    const from = new Date(f.from ?? to.getTime() - 30 * 86400000);
    const predicates = [
      Prisma.sql`u."occurredAt" >= ${from} AND u."occurredAt" <= ${to}`,
    ];
    const where: Prisma.LlmUsageEventWhereInput = {
      occurredAt: { gte: from, lte: to },
    };
    for (const field of [
      "provider",
      "model",
      "agentRole",
      "assessmentId",
      "runId",
      "userId",
      "attemptStatus",
    ] as const) {
      const value = f[field];
      if (value) {
        predicates.push(
          Prisma.sql`${Prisma.raw(`u."${field}"`)}::text = ${value}`,
        );
        Object.assign(where, { [field]: value });
      }
    }
    const tokenMetrics = USAGE_TOKEN_FIELDS.map(
      (field) => Prisma.sql`${field}::text, jsonb_build_object(
      'known', coalesce(sum(${Prisma.raw(`u."${field}"`)}),0)::text,
      'unknownInvocations', count(*) FILTER (WHERE ${Prisma.raw(`u."${field}"`)} IS NULL))`,
    );
    // Aggregate in PostgreSQL: pagination never limits the overview, and rows are not loaded into API memory.
    const aggregate = Prisma.sql`SELECT dimension, key, jsonb_build_object(
      'calls', count(*),
      'successfulResponses', count(*) FILTER (WHERE u."attemptStatus" = ${MODEL_ATTEMPT_STATUSES.COMPLETED}),
      'failedAttempts', count(*) FILTER (WHERE u."attemptStatus" = ${MODEL_ATTEMPT_STATUSES.FAILED}),
      'unresolvedAttempts', count(*) FILTER (WHERE u."attemptStatus" IS NULL OR u."attemptStatus" IN (${MODEL_ATTEMPT_STATUSES.STARTED}, ${MODEL_ATTEMPT_STATUSES.OUTCOME_UNKNOWN})),
      'usageUnknownInvocations', count(*) FILTER (WHERE u."totalTokens" IS NULL AND u."inputTokensIncludingCache" IS NULL AND u."inputTokens" IS NULL AND u."outputTokens" IS NULL),
      'unpricedInvocations', count(*) FILTER (WHERE u."referenceCostSnapshot" IS NULL OR u."referenceCostSnapshot"->>'status' = ${REFERENCE_COST_STATUSES.UNPRICED}),
      'incompleteCostInvocations', count(*) FILTER (WHERE coalesce(u."referenceCostSnapshot"->>'status','') != ${REFERENCE_COST_STATUSES.COMPLETE}),
      'tokens', jsonb_build_object(${Prisma.join(tokenMetrics)}),
      'costAttodollars', coalesce(sum((u."referenceCostSnapshot"->>'knownCostAttodollars')::numeric),0)::text
    ) AS summary FROM "LlmUsageEvent" u CROSS JOIN LATERAL (VALUES
      ('SUMMARY', 'ALL'), (${USAGE_ANALYTICS_DIMENSIONS.PROVIDER}, u.provider),
      (${USAGE_ANALYTICS_DIMENSIONS.MODEL}, coalesce(u."referenceCostSnapshot"->>'canonicalModel', u.model)),
      (${USAGE_ANALYTICS_DIMENSIONS.AGENT_ROLE}, u."agentRole"),
      (${USAGE_ANALYTICS_DIMENSIONS.WORKFLOW}, coalesce(u."assessmentId", u."runId", 'UNKNOWN')),
      (${USAGE_ANALYTICS_DIMENSIONS.DAY}, to_char(u."occurredAt" AT TIME ZONE 'UTC','YYYY-MM-DD')),
      (${USAGE_ANALYTICS_DIMENSIONS.STATUS}, coalesce(u."attemptStatus"::text,'UNKNOWN'))
    ) AS dimensions(dimension,key) WHERE ${Prisma.join(predicates, " AND ")} GROUP BY dimension,key ORDER BY dimension,key`;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const aggregates = await tx.$queryRaw<Aggregate[]>(aggregate);
        const items = await tx.llmUsageEvent.findMany({
          where,
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          skip: (f.page - 1) * f.pageSize,
          take: f.pageSize,
        });
        return { aggregates, items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    /**
     * Business purpose: Expose a known usage-cost subtotal without representing an incomplete
     *   estimate as the full cost.
     *
     * Business rules:
     * - Convert integer attodollars precisely; publish estimatedCostUsd only when
     *   incompleteCostInvocations is zero.
     *
     * Execution flow:
     * 1. Convert the stored known subtotal to USD and set the complete-estimate field to null
     *   when cost evidence is incomplete.
     *
     * Failure cases:
     * - Malformed attodollar input fails conversion; incomplete evidence retains its known
     *   subtotal and a null full estimate.
     *
     * Side effects:
     * - None: pure aggregate projection with no billing mutation.
     */
    const convert = (row: Aggregate) => {
      const { costAttodollars, ...summary } = row.summary;
      const knownEstimatedCostUsd = attodollarsToUsd(BigInt(costAttodollars));
      return {
        ...summary,
        knownEstimatedCostUsd,
        estimatedCostUsd: summary.incompleteCostInvocations
          ? null
          : knownEstimatedCostUsd,
      };
    };
    const overall = result.aggregates.find((x) => x.dimension === "SUMMARY");
    const summary: UsageAnalyticsSummary = overall
      ? convert(overall)
      : {
          calls: 0,
          successfulResponses: 0,
          failedAttempts: 0,
          unresolvedAttempts: 0,
          usageUnknownInvocations: 0,
          unpricedInvocations: 0,
          incompleteCostInvocations: 0,
          knownEstimatedCostUsd: "0",
          estimatedCostUsd: "0",
          tokens: Object.fromEntries(
            USAGE_TOKEN_FIELDS.map((k) => [
              k,
              { known: "0", unknownInvocations: 0 },
            ]),
          ) as UsageAnalyticsSummary["tokens"],
        };
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      summary,
      breakdowns: result.aggregates
        .filter((x) => x.dimension !== "SUMMARY")
        .map((x) => ({
          dimension:
            x.dimension as (typeof USAGE_ANALYTICS_DIMENSIONS)[keyof typeof USAGE_ANALYTICS_DIMENSIONS],
          key: x.key,
          summary: convert(x),
        })),
      items: result.items.map((x) => ({
        id: x.id,
        invocationId: x.invocationId,
        runId: x.runId,
        assessmentId: x.assessmentId,
        agentRole: x.agentRole,
        provider: x.provider,
        model: x.model,
        attemptStatus: x.attemptStatus,
        failureClass: x.failureClass,
        occurredAt: x.occurredAt.toISOString(),
        referenceCost: x.referenceCostSnapshot
          ? referenceCostSnapshotSchema.parse(x.referenceCostSnapshot)
          : null,
        tokens: Object.fromEntries(
          USAGE_TOKEN_FIELDS.map((k) => [k, x[k]?.toString() ?? null]),
        ) as AdminUsageAnalytics["items"][number]["tokens"],
      })),
      page: f.page,
      pageSize: f.pageSize,
      totalCount: summary.calls,
    };
  }
}
