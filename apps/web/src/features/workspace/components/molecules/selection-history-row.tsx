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
        "flex min-h-6 min-w-0 items-center gap-3 text-[12.5px] leading-4.5 text-muted-foreground",
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full bg-primary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 truncate font-medium">
        <span>{prompt}</span>
        <span aria-hidden="true"> · </span>
        <span>{selectedValue}</span>
        {detail ? (
          <span className="text-muted-foreground">
            <span aria-hidden="true"> · </span>
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
