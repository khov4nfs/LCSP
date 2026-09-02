export const ASSESSMENT_CHAT_ROLES = {
  agent: "agent",
  user: "user",
} as const;

export type AssessmentChatRole =
  (typeof ASSESSMENT_CHAT_ROLES)[keyof typeof ASSESSMENT_CHAT_ROLES];

export const TOOL_ACTIVITY_STATUSES = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
} as const;

export type ToolActivityStatus =
  (typeof TOOL_ACTIVITY_STATUSES)[keyof typeof TOOL_ACTIVITY_STATUSES];

export type ChatSingleSelectOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type TurnFooterAction = {
  id: string;
  label: string;
  disabled?: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  onSelect: () => void;
};

export type AssessmentTranscriptAutoScrollKey = string | number;
