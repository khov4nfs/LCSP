import * as React from "react";
import type { ReactNode } from "react";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  ASSESSMENT_CHAT_ROLES,
  type AssessmentChatRole,
} from "../../types/assessment-chat.types";

type AgentTurnProps = {
  role?: AssessmentChatRole;
  content?: ReactNode;
  children?: ReactNode;
  terminalAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

type MessageProps = {
  children?: ReactNode;
  className?: string;
};

type ThoughtLineProps = {
  label: string;
  className?: string;
};

type ThinkingLineProps = {
  label?: string;
  className?: string;
};

export function AgentTurn({
  role = ASSESSMENT_CHAT_ROLES.agent,
  content,
  children,
  terminalAction,
  footer,
  className,
}: AgentTurnProps) {
  const isUser = role === ASSESSMENT_CHAT_ROLES.user;

  return (
    <section
      data-slot="agent-turn"
      data-role={role}
      className={cn(
        "flex w-full min-w-0",
        isUser ? "justify-end" : "justify-start",
        className,
      )}
    >
      <div
        className={cn(
          "min-w-0 text-sm leading-6 text-foreground",
          isUser ? "max-w-[85%] rounded-2xl bg-muted px-3.5 py-2.5" : "w-full",
        )}
      >
        {content ? <div className="whitespace-pre-wrap">{content}</div> : null}
        {children ? (
          <div className={cn(content && "mt-3")}>{children}</div>
        ) : null}
        {terminalAction ? (
          <div data-slot="agent-turn-terminal-action" className="mt-3">
            {terminalAction}
          </div>
        ) : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </section>
  );
}

export function AgentMessage({ children, className }: MessageProps) {
  return (
    <div
      data-slot="agent-message"
      className={cn("min-w-0 text-sm leading-6 text-foreground", className)}
    >
      {children}
    </div>
  );
}

export function UserMessage({ children, className }: MessageProps) {
  return (
    <div
      data-slot="user-message"
      className={cn(
        "ml-auto max-w-[85%] min-w-0 rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-6 text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ThoughtLine({ label, className }: ThoughtLineProps) {
  return (
    <p
      data-slot="thought-line"
      className={cn(
        "min-w-0 text-[12.5px] leading-4.5 font-semibold text-foreground",
        className,
      )}
    >
      {label}
    </p>
  );
}

export function ThinkingLine({
  label = t("pages.appShell.chatThinking"),
  className,
}: ThinkingLineProps) {
  return (
    <p
      data-slot="thinking-line"
      className={cn(
        "min-w-0 text-[12.5px] leading-4.5 text-foreground",
        className,
      )}
    >
      {label}
    </p>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
