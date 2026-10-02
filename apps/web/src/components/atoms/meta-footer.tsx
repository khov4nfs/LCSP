import { cn } from "@/lib/utils";

type MetaFooterProps = {
  /** Already-localized segments; rendered inline, joined by a middle dot. */
  items: string[];
  className?: string;
};

/** Muted, right-aligned secondary line; wraps instead of overflowing. */
export function MetaFooter({ items, className }: MetaFooterProps) {
  if (items.length === 0) return null;
  return (
    <p
      data-slot="meta-footer"
      className={cn(
        "flex min-w-0 flex-wrap justify-end gap-x-1.5 text-right text-[11px] leading-4 tabular-nums text-muted-foreground/80",
        className,
      )}
    >
      {items.map((item, index) => (
        <span key={`${index}:${item}`} className="whitespace-nowrap">
          {index > 0 ? "· " : ""}
          {item}
        </span>
      ))}
    </p>
  );
}
