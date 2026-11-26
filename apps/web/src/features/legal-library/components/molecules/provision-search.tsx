import { SearchIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";

import { Input } from "@/components/ui/input";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export interface ProvisionNavItem {
  id: string;
  locator: string;
  hierarchyPath?: string | null;
}

/**
 * Business purpose: Render a navigable citation link in the Legal Document Reader split-view rail (`CitationLink`).
 * Business rules:
 * - Scrolls smoothly (respecting reduced motion) to the target provision anchor `#chunk-{id}`.
 * Execution flow:
 * 1. Render anchor link with locator and optional hierarchy breadcrumb.
 * Failure cases:
 * - Missing hierarchy path renders only the locator.
 * Side effects:
 * - Pure navigation link.
 */
export function CitationLink({
  item,
  className,
}: {
  item: ProvisionNavItem;
  className?: string;
}) {
  return (
    <a
      href={`#chunk-${encodeURIComponent(item.id)}`}
      className={cn(
        "block rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <p className="truncate font-mono font-medium text-foreground">
        {item.locator}
      </p>
      {item.hierarchyPath ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {item.hierarchyPath}
        </p>
      ) : null}
    </a>
  );
}

/**
 * Business purpose: Render the `ProvisionSearch` filter rail for navigating provisions inside `LegalDocumentReaderPage` (Figma Frame 26).
 * Business rules:
 * - Filters visible provisions on the current reader page without mutating document content.
 * Execution flow:
 * 1. Render search input bound to `query`.
 * 2. Render matching `CitationLink` items.
 * Failure cases:
 * - Empty `items` displays the localized empty provisions message.
 * Side effects:
 * - Invokes `onQueryChange` when typing.
 */
export function ProvisionSearch({
  query,
  onQueryChange,
  items,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  items: readonly ProvisionNavItem[];
  className?: string;
}) {
  return (
    <aside
      aria-label={t("pages.legalLibrary.provisionsNavTitle")}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6rem)]",
        className,
      )}
    >
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("pages.legalLibrary.provisionsNavTitle")} ({items.length})
        </h2>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t("pages.legalLibrary.provisionSearchPlaceholder")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("pages.legalLibrary.provisionSearchPlaceholder")}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {t("pages.legalLibrary.emptyChunks")}
          </p>
        ) : (
          items.map((item) => <CitationLink key={item.id} item={item} />)
        )}
      </nav>
    </aside>
  );
}
