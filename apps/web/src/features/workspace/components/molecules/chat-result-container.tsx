import * as React from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ChatResultContainerProps = {
  header?: ReactNode;
  title?: string;
  eyebrow?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function ChatResultContainer({
  header,
  title,
  eyebrow,
  description,
  children,
  footer,
  className,
}: ChatResultContainerProps) {
  return (
    <section
      data-slot="chat-result-container"
      className={cn(
        "w-full max-w-170 min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card p-4",
        className,
      )}
    >
      {header ? <div className="min-w-0">{header}</div> : null}
      {eyebrow ? (
        <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase">
          {eyebrow}
        </p>
      ) : null}
      {title ? (
        <h3
          className={cn(
            "break-words text-sm font-semibold text-foreground",
            eyebrow && "mt-1",
          )}
        >
          {title}
        </h3>
      ) : null}
      {description ? (
        <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children ? (
        <div
          className={cn("min-w-0", (header || title || eyebrow || description) && "mt-3")}
        >
          {children}
        </div>
      ) : null}
      {footer ? (
        <div className="mt-3 min-w-0 border-t border-border/60 pt-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
