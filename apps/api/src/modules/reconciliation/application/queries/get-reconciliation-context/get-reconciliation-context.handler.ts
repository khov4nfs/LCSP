import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
} from "@lcsp/contracts/evidence";
import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { toPrismaConflictRecordStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  RECONCILIATION_CONTEXT_STATUSES,
  RECONCILIATION_RESOLUTION_PATHS,
  type ReconciliationContextResponse,
  type ReconciliationContextStatus,
} from "../../contracts/reconciliation/reconciliation-context.contract.js";
import { GetReconciliationContextQuery } from "./get-reconciliation-context.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:reconciliation-context-v1";

@QueryHandler(GetReconciliationContextQuery)
export class GetReconciliationContextHandler implements IQueryHandler<
  GetReconciliationContextQuery,
  ReconciliationContextResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetReconciliationContextQuery,
  ): Promise<ReconciliationContextResponse> {
    const flowId =
      query.aiUsageFlowId ??
      (await this.resolveFlowIdFromConflictIds(
        query.assessmentId,
        query.organizationId,
        query.conflictIds,
      ));
    if (!flowId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const conflictStatuses = query.statuses
      .map(toConflictStatus)
      .filter(
        (
          status,
        ): status is (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES] =>
          status !== null,
      );
    const conflicts = await this.prisma.conflictRecord.findMany({
      where: {
        aiUsageFlowId: flowId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
        ...(query.conflictIds.length > 0
          ? {
              id: {
                in: query.conflictIds,
              },
            }
          : {}),
        ...(conflictStatuses.length > 0
          ? {
              status: {
                in: conflictStatuses.map(toPrismaConflictRecordStatus),
              },
            }
          : {}),
        ...(query.cursor
          ? {
              id: {
                gt: decodeCursor(query.cursor) ?? "",
                ...(query.conflictIds.length > 0
                  ? { in: query.conflictIds }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: { id: "asc" },
      take: query.maxResults + 1,
      select: {
        id: true,
        conflictType: true,
        conflictScore: true,
        status: true,
        evidenceRefs: true,
      },
    });
    const truncated = conflicts.length > query.maxResults;
    const page = conflicts.slice(0, query.maxResults);
    const resultConflicts = page.map((conflict) => ({
      conflict_ref: `conflict:${conflict.id}`,
      type: conflict.conflictType,
      status: fromConflictStatus(conflict.status),
      score: conflict.conflictScore,
      summary_key: `CONFLICT_${conflict.conflictType.toUpperCase()}`,
      evidence_refs: asStringRefs(conflict.evidenceRefs),
    }));
    const openConflict = resultConflicts.some(
      (conflict) => conflict.status === RECONCILIATION_CONTEXT_STATUSES.open,
    );
    const response: ReconciliationContextResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getReconciliationContext,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlationId: query.correlationId,
      artifact_versions: { ai_usage_flow_id: flowId },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: resultConflicts.flatMap(
        (conflict) => conflict.evidence_refs,
      ),
      limitations: truncated ? ["RESULT_LIMIT_REACHED"] : [],
      result: {
        conflicts: resultConflicts,
        permitted_resolution_paths: openConflict
          ? [
              {
                path_id: RECONCILIATION_RESOLUTION_PATHS.humanReconcile,
                required_actor: "ASSESSMENT_REVIEWER",
                required_state: RECONCILIATION_CONTEXT_STATUSES.open,
              },
            ]
          : [],
        next_cursor:
          truncated && page.length > 0
            ? encodeCursor(page[page.length - 1].id)
            : null,
        truncated,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.reconciliationContextRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.conflictRecord,
      resourceId: flowId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        flowRef: `flow:${flowId}`,
        conflictIds: query.conflictIds,
        cursor: query.cursor,
      },
    });
    return response;
  }

  private async resolveFlowIdFromConflictIds(
    assessmentId: string,
    organizationId: string,
    conflictIds: string[],
  ): Promise<string | null> {
    if (conflictIds.length === 0) return null;
    const conflicts = await this.prisma.conflictRecord.findMany({
      where: {
        id: { in: conflictIds },
        assessmentId,
        organizationId,
      },
      select: { aiUsageFlowId: true },
      take: conflictIds.length,
    });
    const flowIds = [...new Set(conflicts.map((item) => item.aiUsageFlowId))];
    return flowIds.length === 1 ? flowIds[0] : null;
  }
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded && encodeCursor(decoded) === value.replace(/=+$/u, "")
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function toConflictStatus(
  status: ReconciliationContextStatus,
):
  | (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES]
  | null {
  if (status === RECONCILIATION_CONTEXT_STATUSES.open) {
    return CONFLICT_RECORD_STATUSES.pending;
  }
  if (status === RECONCILIATION_CONTEXT_STATUSES.resolved) {
    return CONFLICT_RECORD_STATUSES.resolved;
  }
  if (status === RECONCILIATION_CONTEXT_STATUSES.dismissed) {
    return CONFLICT_RECORD_STATUSES.dismissed;
  }
  return null;
}

function fromConflictStatus(status: string): ReconciliationContextStatus {
  if (status === CONFLICT_RECORD_STATUSES.pending) {
    return RECONCILIATION_CONTEXT_STATUSES.open;
  }
  if (status === CONFLICT_RECORD_STATUSES.resolved) {
    return RECONCILIATION_CONTEXT_STATUSES.resolved;
  }
  return RECONCILIATION_CONTEXT_STATUSES.dismissed;
}

function asStringRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
