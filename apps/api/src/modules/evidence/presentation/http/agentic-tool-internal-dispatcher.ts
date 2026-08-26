import {
  AGENTIC_TOOL_NAMES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import type { CommandBus } from "@nestjs/cqrs";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { ResumeWaitingRunsCommand } from "../../../legal-rule-catalog/application/commands/resume-waiting-runs/resume-waiting-runs.command.js";
import { RequestTargetedReanalysisCommand } from "../../../scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.command.js";

export type AgenticToolInternalDispatchArgs = {
  toolName: string;
  assessmentId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
};

const INTERNAL_COMMAND_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
  AGENTIC_TOOL_NAMES.resumeWaitingRuns,
]);

const AGENT_RUNTIME_SESSION_ID = "managed-deep-agent-runtime";

/** Return true only for tools handled directly by Nest command handlers. */
export function isAgenticToolInternalCommand(toolName: string): boolean {
  return INTERNAL_COMMAND_TOOL_NAMES.has(toolName);
}

/**
 * Route agent tool requests to local command handlers instead of an external
 * runtime HTTP bridge.
 */
export async function dispatchAgenticToolInternalCommand(
  args: AgenticToolInternalDispatchArgs,
  commandBus: CommandBus,
): Promise<unknown> {
  switch (args.toolName) {
    case AGENTIC_TOOL_NAMES.requestTargetedReanalysis:
      return request_targeted_reanalysis(args, commandBus);
    case AGENTIC_TOOL_NAMES.resumeWaitingRuns:
      return resume_waiting_runs(args, commandBus);
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
  args: AgenticToolInternalDispatchArgs,
  commandBus: CommandBus,
): Promise<unknown> {
  return commandBus.execute(
    new RequestTargetedReanalysisCommand(
      {
        assessmentId: args.assessmentId,
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
      {
        userId: args.userId,
        sessionId: AGENT_RUNTIME_SESSION_ID,
        role: AUTH_USER_ROLES.customer,
        scope: args.assessmentId,
      },
      args.correlationId,
    ),
  );
}

/** Canonical execution adapter for `resume_waiting_runs`. */
export function resume_waiting_runs(
  args: AgenticToolInternalDispatchArgs,
  commandBus: CommandBus,
): Promise<unknown> {
  return commandBus.execute(
    new ResumeWaitingRunsCommand(
      requiredArtifactVersion(
        args.artifactVersions,
        "corpusVersionId",
        args.correlationId,
      ),
      numberWithDefault(args.input.maxRuns, 25),
      requiredString(args.input.idempotencyKey, args.correlationId),
      args.correlationId,
    ),
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
