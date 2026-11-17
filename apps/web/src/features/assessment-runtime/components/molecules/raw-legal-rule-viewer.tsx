"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLegalLibraryChunkPageQuery } from "@/lib/api/legal-source-queries";
import { copy } from "../../utils/conversation-copy";

type RawLegalRuleViewerProps = {
  documentTitle: string;
  documentNumber: string | null;
  locator: string;
  documentRowId: string | null;
  sourceUrl: string | null;
  effectiveStatus: string | null;
  effectiveDate: string | null;
  hasOriginal: boolean;
  rawContent?: string | null;
};

export function RawLegalRuleViewer({
  documentTitle,
  documentNumber,
  locator,
  documentRowId,
  sourceUrl,
  effectiveStatus,
  effectiveDate,
  hasOriginal,
  rawContent,
}: RawLegalRuleViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // If documentRowId exists, query chunk page to load authentic verbatim chunk
  const chunksQuery = useLegalLibraryChunkPageQuery({
    documentRowId: documentRowId ?? "",
    page: 1,
    pageSize: 50,
    enabled: Boolean(documentRowId),
  });

  // Find exact or closest chunk matching locator
  const matchedChunk = chunksQuery.data?.items?.find((item) => {
    const itemLoc = item.locator.toLowerCase();
    const targetLoc = locator.toLowerCase();
    return itemLoc.includes(targetLoc) || targetLoc.includes(itemLoc);
  });

  const displayContent =
    matchedChunk?.content ?? rawContent ?? null;
  const isLong = (displayContent?.length ?? 0) > 300;

  return (
    <section
      data-slot="raw-legal-rule-viewer"
      aria-labelledby="raw-legal-rule-title"
      className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-4"
    >
      {/* Header with Title and Locator */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="flex items-center gap-1.5 font-medium">
            <BookOpenIcon className="size-3.5 text-primary" aria-hidden="true" />
            <span>{documentTitle}</span>
          </Badge>
          {documentNumber && (
            <Badge variant="secondary" className="font-mono text-xs">
              {documentNumber}
            </Badge>
          )}
          <Badge variant="default" className="font-semibold text-xs">
            {locator}
          </Badge>
        </div>

        {/* Legal Effect Status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {effectiveStatus && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              {effectiveStatus}
            </span>
          )}
          {effectiveDate && <span>· {effectiveDate}</span>}
        </div>
      </div>

      {/* Verbatim Content Box */}
      <div className="relative rounded-md border-l-4 border-primary bg-card/80 p-3.5 font-serif text-sm leading-relaxed text-foreground shadow-xs">
        <h4 id="raw-legal-rule-title" className="sr-only">
          {copy("decision.rawLegalRule")}
        </h4>

        {chunksQuery.isPending && !rawContent ? (
          <div className="space-y-2" role="status">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : displayContent ? (
          <div
            className={cn(
              "whitespace-pre-wrap font-sans text-sm",
              !isExpanded && isLong && "line-clamp-4 overflow-hidden",
            )}
          >
            {displayContent}
          </div>
        ) : (
          <p className="font-sans text-sm italic text-muted-foreground">
            {copy("decision.ruleFallback", { id: locator })} — {documentTitle}
          </p>
        )}

        {isLong && displayContent && (
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="h-7 text-xs font-medium text-primary hover:text-primary/80"
            >
              {isExpanded ? (
                <>
                  <ChevronUpIcon className="mr-1 size-3.5" aria-hidden="true" />
                  {copy("decision.rawLegalRuleCollapse")}
                </>
              ) : (
                <>
                  <ChevronDownIcon className="mr-1 size-3.5" aria-hidden="true" />
                  {copy("decision.rawLegalRuleExpand")}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* External Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        {documentRowId && (
          <Link
            href={`/laws/${encodeURIComponent(documentRowId)}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-8 text-xs gap-1.5",
            )}
          >
            <BookOpenIcon className="size-3.5" aria-hidden="true" />
            <span>{copy("decision.viewOriginalDocument")}</span>
          </Link>
        )}
        {documentRowId && hasOriginal && (
          <Link
            href={`/laws/${encodeURIComponent(documentRowId)}/file`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground",
            )}
          >
            <FileTextIcon className="size-3.5" aria-hidden="true" />
            <span>{copy("decision.viewOriginalFile")}</span>
          </Link>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground",
            )}
          >
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            <span>{copy("decision.viewInLegalLibrary")}</span>
          </a>
        )}
      </div>
    </section>
  );
}
