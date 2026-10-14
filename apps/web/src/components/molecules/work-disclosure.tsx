import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkDisclosureProps } from "@/components/types/chat.types";

/**
 * A compact "Working… / Worked for 26s" disclosure. It is open and animated only while the work
 * is in flight and collapses by itself once it settles; the reader can still open it. The native
 * <details> keeps it keyboard accessible without any script.
 */
export function WorkDisclosure({
  summary,
  running,
  defaultExpanded,
  meta,
  children,
  className,
}: WorkDisclosureProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? running);
  const followsRunning = defaultExpanded === undefined;
  const isOpen = followsRunning ? running : expanded;

  return (
    <details
      data-slot="work-disclosure"
      data-running={running ? "true" : "false"}
      open={isOpen}
      onToggle={(event) => {
        if (!followsRunning) setExpanded(event.currentTarget.open);
      }}
      className={cn("group/work min-w-0 text-sm", className)}
    >
      <summary
        aria-expanded={followsRunning ? undefined : isOpen}
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-muted-foreground select-none",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {running ? (
          <LoaderCircleIcon
            aria-hidden="true"
            data-slot="work-spinner"
            className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {followsRunning && running ? null : (
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-open/work:rotate-90 motion-reduce:transition-none"
          />
        )}
        <span className="font-medium">{summary}</span>
        {meta ? <span className="ml-auto text-xs">{meta}</span> : null}
      </summary>
      {children ? (
        <div className="mt-1 flex flex-col gap-2 pl-5.5">{children}</div>
      ) : null}
    </details>
  );
}
