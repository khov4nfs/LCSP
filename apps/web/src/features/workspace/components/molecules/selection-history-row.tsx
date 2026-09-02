import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type SelectionHistoryRowProps = {
  prompt: string;
  selectedValue: string;
  detail?: string;
  className?: string;
};

export function SelectionHistoryRow({
  prompt,
  selectedValue,
  detail,
  className,
}: SelectionHistoryRowProps) {
  return (
    <div
      data-slot="selection-history-row"
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5",
        className,
      )}
    >
      <CheckIcon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5 text-muted-foreground">{prompt}</p>
        <p className="text-sm font-medium text-foreground">{selectedValue}</p>
        {detail ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
