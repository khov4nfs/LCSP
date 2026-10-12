import { cn } from "@/lib/utils";
import type { ChatInteractionBarProps } from "@/components/types/chat.types";

/**
 * The sticky bottom interaction area of a conversation: one quiet surface that carries the
 * current action (Stop, Continue, report actions), never a stack of cards above the thread.
 */
export function ChatInteractionBar({
  children,
  className,
}: ChatInteractionBarProps) {
  return (
    <div
      data-slot="chat-interaction-bar"
      className={cn(
        "sticky bottom-0 z-10 shrink-0 bg-background/95 px-4 pt-2 pb-4 backdrop-blur sm:px-0",
        className,
      )}
    >
      <div className="mx-auto flex min-h-11 w-full max-w-3xl items-center gap-3 rounded-2xl border border-input bg-card px-4 py-2 shadow-sm">
        {children}
      </div>
    </div>
  );
}
