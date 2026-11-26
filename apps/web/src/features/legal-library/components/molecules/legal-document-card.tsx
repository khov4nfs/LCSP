import Link from "next/link";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import type { ActiveLegalLibrary } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type LegalLibraryDocument = ActiveLegalLibrary["documents"][number];

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Business purpose: Render a single document card in the Legal Library matching Figma `LCSP Data / Legal document card` (`1684:3067`).
 * Business rules:
 * - Preserves authentic document title, effective status, effective date, and chunk count.
 * - External `Open source` link renders only when `sourceUrl` is a valid `https:` URL.
 * Execution flow:
 * 1. Render `§` section icon badge, document title, and status/date/chunk metadata.
 * 2. Render divider and `Read document` / `Open official source` actions.
 * Failure cases:
 * - Invalid or non-HTTPS `sourceUrl` omits the external link without error.
 * Side effects:
 * - Pure presentational component with Next.js navigation.
 */
export function LegalDocumentCard({
  document,
  className,
}: {
  document: LegalLibraryDocument;
  className?: string;
}) {
  const safeExternalUrl = httpsUrl(document.sourceUrl);

  return (
    <article
      className={cn(
        "flex h-full flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-brand/40",
        className,
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-mint text-base font-semibold text-brand-deep"
          >
            §
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-foreground">
              {document.title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {document.sourceEffectStatus}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <dt>{t("pages.legalLibrary.effectiveDateLabel")}</dt>
            <dd className="font-medium text-foreground">
              {document.effectiveDate ?? "—"}
            </dd>
          </div>
          <div>
            <dt>{t("pages.legalLibrary.chunkCountLabel")}</dt>
            <dd className="font-medium text-foreground">
              {document.chunkCount}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm font-medium">
        <Link
          href={`/laws/${encodeURIComponent(document.id)}`}
          className="inline-flex items-center gap-1 text-brand-deep hover:text-brand focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span>{t("pages.legalLibrary.readDocument")}</span>
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </Link>

        {safeExternalUrl ? (
          <a
            href={safeExternalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-deep hover:text-brand focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>{t("pages.legalLibrary.openOfficialSource")}</span>
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function httpsUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
