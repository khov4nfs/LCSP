import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import type { PbacAction } from "@lcsp/contracts/pbac";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";

export type AgenticToolCommandDispatchArgs = {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  policyId?: string | null;
  policyVersion?: string | null;
  correlationId: string;
  input: Record<string, unknown>;
};

const PROTECTED_COMMAND_ACTIONS: Readonly<Record<string, PbacAction>> = {};

/** Return true only for centrally registered protected mutation tools. */
export function isAgenticToolCommand(toolName: string): boolean {
  return toolName in PROTECTED_COMMAND_ACTIONS;
}

/** Resolve the mandatory PBAC action for one protected canonical tool. */
export function agenticToolCommandPbacAction(toolName: string): PbacAction {
  const action = PROTECTED_COMMAND_ACTIONS[toolName];
  if (!action) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return action;
}

/** Resolve one protected canonical name to the Nest command owning its mutation. */
export function buildAgenticToolCommand(
  args: AgenticToolCommandDispatchArgs,
): never {
  throw problemException(EVIDENCE_ERROR_CODES.notFound, args.correlationId, {
    status: HttpStatus.NOT_FOUND,
  });
}
