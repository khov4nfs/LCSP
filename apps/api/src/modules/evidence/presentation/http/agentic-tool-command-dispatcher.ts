import {
  AGENTIC_TOOL_NAMES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { CaptureVerifiedAgentEpisodeCommand } from "../../application/commands/capture-verified-agent-episode/capture-verified-agent-episode.command.js";

export type AgenticToolCommandDispatchArgs = {
  toolName: string;
  assessmentId: string;
  userId: string;
  correlationId: string;
  input: Record<string, unknown>;
};

const PROTECTED_COMMAND_ACTIONS: Readonly<Record<string, string>> = {};
const UNPROTECTED_APPLICATION_COMMANDS = new Set<string>([
  AGENTIC_TOOL_NAMES.captureVerifiedEpisode,
]);

/** Return true only for centrally registered protected mutation tools. */
export function isAgenticToolProtectedCommand(toolName: string): boolean {
  return toolName in PROTECTED_COMMAND_ACTIONS;
}

/** Return true only for centrally registered mutation tools. */
export function isAgenticToolCommand(toolName: string): boolean {
  return (
    toolName in PROTECTED_COMMAND_ACTIONS ||
    UNPROTECTED_APPLICATION_COMMANDS.has(toolName)
  );
}

/** Resolve the mandatory RBAC action for one protected canonical tool. */
export function agenticToolCommandRbacAction(toolName: string): string {
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
): CaptureVerifiedAgentEpisodeCommand {
  if (args.toolName === AGENTIC_TOOL_NAMES.captureVerifiedEpisode) {
    return new CaptureVerifiedAgentEpisodeCommand(
      args.assessmentId,
      args.input,
      args.userId,
      args.correlationId,
    );
  }
  throw problemException(EVIDENCE_ERROR_CODES.notFound, args.correlationId, {
    status: HttpStatus.NOT_FOUND,
  });
}
