import type { DeveloperAllowedAction } from "./types.ts";

import { PBAC_ACTIONS } from "./actions.ts";

export const DEVELOPER_SUBJECT_ROLE = "Developer";

export const DEVELOPER_ALLOWED_ACTION_VALUES = [
  PBAC_ACTIONS.assessmentList,
  PBAC_ACTIONS.evidenceReadRedacted,
  "ai-usage-flow:read",
  "findings:read:redacted",
  "conflict:comment",
  PBAC_ACTIONS.scanRead,
] as const;

export const DEVELOPER_ALLOWED_ACTIONS: string[] = [
  ...DEVELOPER_ALLOWED_ACTION_VALUES,
];

export function isDeveloperAllowedAction(
  action: string,
): action is DeveloperAllowedAction {
  return (DEVELOPER_ALLOWED_ACTIONS as readonly string[]).includes(action);
}
