import { cn } from "@/lib/utils";
import {
  CHAT_MESSAGE_ROLES,
  type ChatMessageProps,
} from "@/components/types/chat.types";

/**
 * One conversation message. Agent output is unboxed, full width text; the user's reply is a
 * restrained compact bubble aligned to the end. No border, no card, no badge.
 */
export function ChatMessage({
  role,
  author,
  children,
  className,
}: ChatMessageProps) {
  const isUser = role === CHAT_MESSAGE_ROLES.user;
  return (
    <section
      data-slot="chat-message"
      data-role={role}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1",
        isUser ? "items-end" : "items-start",
        className,
      )}
    >
      {author ? (
        <p className="text-xs font-medium text-muted-foreground">{author}</p>
      ) : null}
      <div
        className={cn(
          "min-w-0 text-sm leading-6 text-foreground",
          isUser
            ? "w-fit max-w-full rounded-2xl bg-muted px-3.5 py-2 whitespace-pre-wrap sm:max-w-xl"
            : "w-full",
        )}
      >
        {children}
      </div>
    </section>
  );
}
