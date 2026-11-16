"use client";

import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import type {
  PreparationSourceContentResponse,
  PreparationSourceUnitDetailResponse,
  PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_DOCUMENT_NODE_TYPES,
  type LegalDocumentNodeType,
} from "@lcsp/contracts/legal-source";
import { PREPARATION_SOURCE_CONTENT_AVAILABILITY } from "@lcsp/contracts/compliance-rule-set";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { usePreparationSourceNodeContentQuery } from "@/lib/api/compliance-rule-set-queries";

const t = (key: string) => resolveAppMessage(key as MessageKey);
const NODE_TYPE_MESSAGE_KEYS: Record<LegalDocumentNodeType, MessageKey> = {
  DOCUMENT: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.DOCUMENT",
  PART: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.PART",
  TITLE: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.TITLE",
  CHAPTER: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.CHAPTER",
  SUBCHAPTER: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.SUBCHAPTER",
  SECTION: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.SECTION",
  SUBSECTION: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.SUBSECTION",
  ARTICLE: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.ARTICLE",
  CLAUSE: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.CLAUSE",
  PARAGRAPH: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.PARAGRAPH",
  SUBPARAGRAPH:
    "pages.complianceRuleSets.sourceAnalysis.nodeTypes.SUBPARAGRAPH",
  POINT: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.POINT",
  ITEM: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.ITEM",
  ANNEX: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.ANNEX",
  SCHEDULE: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.SCHEDULE",
  TABLE: "pages.complianceRuleSets.sourceAnalysis.nodeTypes.TABLE",
  DEFINITION_BLOCK:
    "pages.complianceRuleSets.sourceAnalysis.nodeTypes.DEFINITION_BLOCK",
  UNSTRUCTURED_BLOCK:
    "pages.complianceRuleSets.sourceAnalysis.nodeTypes.UNSTRUCTURED_BLOCK",
};

/**
 * Business purpose: Present a persisted legal node with a localized semantic type while preserving its stored identity.
 *
 * Business rules:
 * - A semantic prefix is added only when the persisted nodeType is known and the stored label is a short ordinal.
 * - Existing descriptive labels/titles are retained; absent legal titles are never synthesized from position or ancestors.
 *
 * Execution flow:
 * 1. Resolve the localized node-type label from the shared EN/VI message catalog.
 * 2. Prefer the persisted label, then title, and use the type label alone if both are absent.
 * 3. Prefix short persisted ordinals with the verified type and append a distinct stored title when present.
 *
 * Failure cases:
 * - Empty stored identity falls back only to the persisted nodeType label, not an inferred legal title.
 *
 * Side effects:
 * - Pure presentation projection; no graph, review state, or legal content is changed.
 */
export function formatPreparationLegalSourceNodeLabel(node: {
  nodeType: LegalDocumentNodeType;
  label: string;
  title: string;
}): string {
  const typeLabel = resolveAppMessage(NODE_TYPE_MESSAGE_KEYS[node.nodeType]);
  const label = node.label.trim();
  const title = node.title.trim();
  const storedLabel = label || title;
  if (node.nodeType === LEGAL_DOCUMENT_NODE_TYPES.DOCUMENT) {
    return storedLabel || typeLabel;
  }
  if (!label) {
    return title ? `${typeLabel}: ${title}` : typeLabel;
  }

  const isShortOrdinal = /^[\p{L}\p{N}]+(?:[./-][\p{L}\p{N}]+)*$/u.test(label);
  if (!isShortOrdinal) return label;

  const semanticLabel = `${typeLabel} ${label}`;
  const distinctTitle =
    title === label
      ? ""
      : title.startsWith(semanticLabel)
        ? title.slice(semanticLabel.length).replace(/^\s*[-:–]?\s*/u, "")
        : title;
  return distinctTitle ? `${semanticLabel} — ${distinctTitle}` : semanticLabel;
}

type SourceUnit = PreparationSourceUnitsResponse["units"][number];
type Ancestor = PreparationSourceUnitDetailResponse["ancestors"][number];
type ContentNode = Pick<
  PreparationSourceContentResponse,
  "sourceNodeId" | "nodeType" | "label" | "title" | "structuralPath"
>;

type PreparationSourceContentReaderProps = {
  preparationRunId: string;
  inventoryRevision: number;
  unit: SourceUnit;
  ancestors: Ancestor[];
};

/**
 * Business purpose: Let an Admin read exact pinned legal text for the selected unit or a persisted node in its hierarchy.
 *
 * Business rules:
 * - Content navigation reads only the selected run/revision and server-verified node identities; it never changes SourceReview selection.
 * - Only bounded, schema-validated text pages are rendered as text, and empty content remains distinct from unavailable content.
 * - Ancestor and child nodes are navigable only when their persisted identities are supplied by the pinned read model.
 *
 * Execution flow:
 * 1. Offer the selected unit and persisted ancestors as explicit content-view actions.
 * 2. Fetch one selected node through the pinned content query and append server pages in order.
 * 3. Offer persisted child nodes only after the server returns them for the same pinned materialization.
 *
 * Failure cases:
 * - Loading, valid empty text, unavailable node, request failure, and truncated content have separate messages and actions.
 *
 * Side effects:
 * - Read-only authenticated requests and local viewing state; review, run, and source records remain unchanged.
 */
export function PreparationSourceContentReader({
  preparationRunId,
  inventoryRevision,
  unit,
  ancestors,
}: PreparationSourceContentReaderProps) {
  const [viewedNodeId, setViewedNodeId] = useState<string | null>(null);
  const contentQuery = usePreparationSourceNodeContentQuery(
    preparationRunId,
    inventoryRevision,
    viewedNodeId,
  );
  const pages = contentQuery.data?.pages ?? [];
  const firstPage = pages[0];
  const fullText = pages.map((page) => page.content).join("");
  const navigationNodes: ContentNode[] = [
    ...ancestors,
    {
      sourceNodeId: unit.sourceNodeId,
      nodeType: unit.nodeType,
      label: unit.label,
      title: unit.title,
      structuralPath: unit.structuralPath,
    },
  ];

  return (
    <section
      aria-labelledby="preparation-source-content-title"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="space-y-1">
        <h3 id="preparation-source-content-title" className="font-semibold">
          {t("pages.complianceRuleSets.sourceAnalysis.sourceContentTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.sourceContentAuthority")}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap gap-2">
        {navigationNodes.map((node) => (
          <Button
            key={node.sourceNodeId}
            type="button"
            size="sm"
            variant={viewedNodeId === node.sourceNodeId ? "default" : "outline"}
            aria-label={`${t("pages.complianceRuleSets.sourceAnalysis.viewLegalSourceContent")}: ${formatPreparationLegalSourceNodeLabel(node)}`}
            onClick={() => setViewedNodeId(node.sourceNodeId)}
          >
            {formatPreparationLegalSourceNodeLabel(node)}
          </Button>
        ))}
      </div>

      {!viewedNodeId ? (
        <p className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.selectSourceContentNode")}
        </p>
      ) : null}
      {contentQuery.isPending && viewedNodeId ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.sourceContentLoading")}
        </p>
      ) : null}
      {contentQuery.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>
            {t(
              "pages.complianceRuleSets.sourceAnalysis.sourceContentUnavailable",
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void contentQuery.refetch()}
          >
            {t("pages.complianceRuleSets.sourceAnalysis.retrySourceContent")}
          </Button>
        </div>
      ) : null}
      {firstPage ? (
        <div className="space-y-3">
          <header className="min-w-0 space-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <h4 className="wrap-break-word font-medium">
              {formatPreparationLegalSourceNodeLabel(firstPage)}
            </h4>
            <p className="wrap-break-word text-xs text-muted-foreground">
              <code>{firstPage.structuralPath}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("pages.complianceRuleSets.sourceAnalysis.sourceVersion")}:{" "}
              {firstPage.legalSourceVersionId}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("pages.complianceRuleSets.sourceAnalysis.contentLocation")}:{" "}
              {formatLocation(firstPage, t)}
            </p>
          </header>

          {firstPage.availability ===
          PREPARATION_SOURCE_CONTENT_AVAILABILITY.EMPTY ? (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {t("pages.complianceRuleSets.sourceAnalysis.sourceContentEmpty")}
            </p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border border-border bg-background p-4">
              <pre className="wrap-break-word whitespace-pre-wrap font-sans text-sm leading-7">
                {fullText}
              </pre>
            </div>
          )}

          {contentQuery.hasNextPage ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t(
                  "pages.complianceRuleSets.sourceAnalysis.sourceContentIncomplete",
                )}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={contentQuery.isFetchingNextPage}
                onClick={() => void contentQuery.fetchNextPage()}
              >
                {t(
                  contentQuery.isFetchingNextPage
                    ? "pages.complianceRuleSets.sourceAnalysis.sourceContentLoading"
                    : "pages.complianceRuleSets.sourceAnalysis.loadMoreSourceContent",
                )}
              </Button>
            </div>
          ) : null}

          {firstPage.children.length ? (
            <section className="space-y-2">
              <h4 className="text-sm font-medium">
                {t(
                  "pages.complianceRuleSets.sourceAnalysis.relatedSourceNodes",
                )}
              </h4>
              <ul className="flex min-w-0 flex-wrap gap-2">
                {firstPage.children.map((child) => (
                  <li key={child.sourceNodeId} className="min-w-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`${t("pages.complianceRuleSets.sourceAnalysis.viewLegalSourceContent")}: ${formatPreparationLegalSourceNodeLabel(child)}`}
                      onClick={() => setViewedNodeId(child.sourceNodeId)}
                    >
                      {formatPreparationLegalSourceNodeLabel(child)}
                    </Button>
                  </li>
                ))}
              </ul>
              {firstPage.childrenTruncated ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "pages.complianceRuleSets.sourceAnalysis.relatedNodesTruncated",
                  )}
                </p>
              ) : null}
            </section>
          ) : null}

          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t(
                "pages.complianceRuleSets.sourceAnalysis.sourceContentTechnicalIdentity",
              )}
            </summary>
            <dl className="grid min-w-0 gap-2 break-all pt-3 text-xs sm:grid-cols-2">
              <TechnicalValue
                label={t(
                  "pages.complianceRuleSets.sourceAnalysis.sourceNodeId",
                )}
                value={firstPage.sourceNodeId}
              />
              <TechnicalValue
                label={t("pages.complianceRuleSets.sourceAnalysis.documentId")}
                value={firstPage.documentId}
              />
              <TechnicalValue
                label={t(
                  "pages.complianceRuleSets.sourceAnalysis.materialization",
                )}
                value={firstPage.materializationId}
              />
              <TechnicalValue
                label={t(
                  "pages.complianceRuleSets.sourceAnalysis.contentFingerprint",
                )}
                value={firstPage.contentFingerprint}
              />
              <TechnicalValue
                label={t(
                  "pages.complianceRuleSets.sourceAnalysis.inventoryRevision",
                )}
                value={String(firstPage.inventoryRevision)}
              />
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Business purpose: Present persisted page and character source locators without inventing unavailable coordinates.
 *
 * Business rules:
 * - Only non-null stored page and character offsets are displayed, in their original inclusive/exclusive contract meaning.
 * - Missing locators use a localized not-recorded message.
 *
 * Execution flow:
 * 1. Build the available page and character ranges from persisted metadata.
 * 2. Join available ranges or return the localized empty-location label.
 *
 * Failure cases:
 * - Missing coordinates are represented as unavailable metadata and never inferred from text length.
 *
 * Side effects:
 * - Pure presentation formatting; no source record or locator is changed.
 */
function formatLocation(
  content: PreparationSourceContentResponse,
  translate: (key: string) => string,
) {
  const pageRange =
    content.pageStart === null
      ? ""
      : content.pageEnd === null || content.pageEnd === content.pageStart
        ? String(content.pageStart)
        : `${content.pageStart}–${content.pageEnd}`;
  const characterRange =
    content.charStart === null
      ? ""
      : content.charEnd === null
        ? String(content.charStart)
        : `${content.charStart}–${content.charEnd}`;
  return (
    [pageRange, characterRange].filter(Boolean).join(" · ") ||
    translate("pages.complianceRuleSets.sourceAnalysis.locationNotRecorded")
  );
}

function TechnicalValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word">
        <code>{value}</code>
      </dd>
    </div>
  );
}
