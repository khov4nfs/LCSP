import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  ASSESSMENT_CHAT_ROLES,
  type AssessmentChatRole,
} from "../../types/assessment-chat.types";

type AgentTurnProps = {
  role?: AssessmentChatRole;
  content?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function AgentTurn({
  role = ASSESSMENT_CHAT_ROLES.agent,
  content,
  children,
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
        <div
          className={cn(
            "flex min-w-0 items-start gap-2",
            isUser && "flex-col items-stretch",
          )}
        >
          <div className="min-w-0 flex-1">
            {content ? (
              <div className="whitespace-pre-wrap">{content}</div>
            ) : null}
            {children ? (
              <div className={cn(content && "mt-3")}>{children}</div>
            ) : null}
          </div>
          {!isUser && footer ? (
            <div className="max-w-[45%] flex-none self-start">{footer}</div>
          ) : null}
        </div>
        {isUser && footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </section>
  );
}
