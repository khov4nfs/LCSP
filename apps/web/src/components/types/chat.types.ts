import type { ReactNode } from "react";

export const CHAT_MESSAGE_ROLES = {
  agent: "agent",
  user: "user",
} as const;
export type ChatMessageRole =
  (typeof CHAT_MESSAGE_ROLES)[keyof typeof CHAT_MESSAGE_ROLES];

export type ChatMessageProps = {
  role: ChatMessageRole;
  /** Already-localized author line; only shown when provided. */
  author?: string;
  children: ReactNode;
  className?: string;
};

export type WorkDisclosureProps = {
  /** Already-localized one-line summary ("Working…", "Worked for 18s"). */
  summary: string;
  /** Animate and expand while the work is in flight; collapse once it settles. */
  running: boolean;
  /** Keep the user's disclosure choice stable when streamed content changes. */
  defaultExpanded?: boolean;
  /** Secondary text shown at the end of the summary row (usage). */
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export type ChatInteractionBarProps = {
  children: ReactNode;
  className?: string;
};
