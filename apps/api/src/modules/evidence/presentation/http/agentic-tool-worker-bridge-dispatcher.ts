import {
  AGENTIC_TOOL_NAMES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import type { PythonWorkerRuntimeClient } from "../../application/services/evidence/python-worker-runtime.client.js";

export type AgenticToolWorkerBridgeArgs = {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
};

const WORKER_BRIDGE_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
  AGENTIC_TOOL_NAMES.resumeWaitingRuns,
]);

/** Return true only for tools whose execution crosses the Python worker bridge. */
export function isAgenticToolWorkerBridge(toolName: string): boolean {
  return WORKER_BRIDGE_TOOL_NAMES.has(toolName);
}

/**
 * Single worker-bridge routing table. Each case delegates to a real exported
 * function whose name exactly matches the canonical snake_case tool name.
 */
export async function dispatchAgenticToolWorkerBridge(
  args: AgenticToolWorkerBridgeArgs,
  client: PythonWorkerRuntimeClient,
): Promise<unknown> {
  switch (args.toolName) {
    case AGENTIC_TOOL_NAMES.requestTargetedReanalysis:
      return request_targeted_reanalysis(args, client);
    case AGENTIC_TOOL_NAMES.resumeWaitingRuns:
      return resume_waiting_runs(args, client);
    default:
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        args.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
  }
}

/** Canonical execution adapter for `request_targeted_reanalysis`. */
export function request_targeted_reanalysis(
  args: AgenticToolWorkerBridgeArgs,
  client: PythonWorkerRuntimeClient,
): Promise<unknown> {
  return client.requestTargetedReanalysis(
    {
      assessmentId: args.assessmentId,
      organizationId: args.organizationId,
      userId: args.userId,
      inputArtifactVersion: requiredArtifactVersion(
        args.artifactVersions,
        "technicalEvidenceReportId",
        args.correlationId,
      ),
      analyzerId: requiredString(args.input.analyzerId, args.correlationId),
      scope: requiredScope(args.input.scope, args.correlationId),
      reasonRequirementId: requiredString(
        args.input.reasonRequirementId,
        args.correlationId,
      ),
      idempotencyKey: requiredString(
        args.input.idempotencyKey,
        args.correlationId,
      ),
    },
    args.correlationId,
  );
}

/** Canonical execution adapter for `resume_waiting_runs`. */
export function resume_waiting_runs(
  args: AgenticToolWorkerBridgeArgs,
  client: PythonWorkerRuntimeClient,
): Promise<unknown> {
  return client.resumeWaitingRuns(
    {
      corpusVersionId: requiredArtifactVersion(
        args.artifactVersions,
        "corpusVersionId",
        args.correlationId,
      ),
      maxRuns: numberWithDefault(args.input.maxRuns, 25),
      idempotencyKey: requiredString(
        args.input.idempotencyKey,
        args.correlationId,
      ),
    },
    args.correlationId,
  );
}

function requiredArtifactVersion(
  input: Record<string, unknown>,
  key: string,
  correlationId: string,
): string {
  return requiredString(input[key], correlationId);
}

function requiredString(value: unknown, correlationId: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(correlationId);
  }
  return value.trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function numberWithDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function requiredScope(
  value: unknown,
  correlationId: string,
): { pathPrefixes: string[] } | { subjectRefs: string[] } {
  const scope = record(value);
  if (!scope) {
    invalid(correlationId);
  }
  const pathPrefixes = stringArray(scope.pathPrefixes);
  const subjectRefs = stringArray(scope.subjectRefs);
  if (pathPrefixes.length > 0 && subjectRefs.length === 0) {
    return { pathPrefixes };
  }
  if (subjectRefs.length > 0 && pathPrefixes.length === 0) {
    return { subjectRefs };
  }
  invalid(correlationId);
}

function invalid(correlationId: string): never {
  throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
