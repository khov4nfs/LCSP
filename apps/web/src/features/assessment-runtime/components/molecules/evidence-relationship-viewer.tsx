"use client";

import { useState } from "react";
import {
  FileCodeIcon,
  SearchIcon,
  AlertCircleIcon,
  ArrowUpRightIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ASSESSMENT_EVIDENCE_TYPES } from "@lcsp/contracts/assessment-domain";
import {
  buildRepositorySourceLink,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import type { LegalRuleEvidenceItem } from "../../types/legal-rule-output.types";
import { copy } from "../../utils/conversation-copy";

type EvidenceRelationshipViewerProps = {
  evidenceList: LegalRuleEvidenceItem[];
  hasEvidenceGap: boolean;
  onNavigateToObligation?: (criterionId?: string | null) => void;
  sourceContext?: {
    provider: CredentialProvider;
    canonicalRepositoryUrl: string;
    commitSha: string;
  } | null;
};

/**
 * Business purpose: Display persisted evidence and optional external source citations tied to a pinned repository snapshot.
 * Business rules: External links are generated only for repository-source evidence with validated provider URL, full commit SHA, safe relative path, and valid line range; internal evidence remains visible if provenance is incomplete.
 * Execution flow: 1. Render the evidence and excerpts. 2. Derive a provider-specific link from trusted snapshot context. 3. Offer the link only when the shared builder validates it.
 * Failure cases: Unsafe paths or missing provenance omit the external link without hiding or changing evidence.
 * Side effects: Reads evidence props and opens a provider URL only after the customer follows the link; no evidence is modified.
 */
export function EvidenceRelationshipViewer({
  evidenceList,
  hasEvidenceGap,
  onNavigateToObligation,
  sourceContext,
}: EvidenceRelationshipViewerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (hasEvidenceGap || evidenceList.length === 0) {
    return (
      <div
        data-slot="evidence-gap"
        className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-50/40 p-4 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-200"
      >
        <AlertCircleIcon className="mt-0.5 size-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">{copy("decision.evidenceGap")}</p>
          <p className="text-muted-foreground dark:text-amber-300/80">
            {copy("decision.evidenceGapNotice")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-slot="evidence-relationship-viewer" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {evidenceList.map((item, index) => {
          const isSource =
            item.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE;
          const locationLabel = item.path
            ? `${item.path}${item.startLine ? `:${item.startLine}-${item.endLine}` : ""}`
            : item.evidenceId;
          const sourceLink =
            isSource && item.path && sourceContext
              ? buildRepositorySourceLink({
                  ...sourceContext,
                  path: item.path,
                  startLine: item.startLine,
                  endLine: item.endLine,
                })
              : null;

          return (
            <li
              key={item.evidenceId || index}
              id={`evidence-${item.evidenceId}`}
              className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3.5 shadow-2xs transition-colors hover:border-primary/40"
            >
              {/* Evidence Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="flex items-center gap-1 font-mono text-xs">
                    {isSource ? (
                      <FileCodeIcon className="size-3 text-indigo-500" aria-hidden="true" />
                    ) : (
                      <SearchIcon className="size-3 text-sky-500" aria-hidden="true" />
                    )}
                    <span>{copy(isSource ? "decision.evidenceTypeRepo" : item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE ? "decision.evidenceTypeInspection" : "decision.evidence")}</span>
                  </Badge>

                  {item.path ? (
                    <span className="font-mono text-xs font-semibold text-foreground break-all">
                      {item.path}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-foreground">
                      {copy("decision.evidenceArtifact")}
                    </span>
                  )}

                  {item.startLine && item.endLine && (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {copy("decision.evidenceLocation")}: {item.startLine}–{item.endLine}
                    </Badge>
                  )}
                </div>

                {/* Actions & Copy */}
                <div className="flex items-center gap-1.5">
                  {sourceLink ? (
                    <a
                      href={sourceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <span>{copy("viewOriginalFile")}</span>
                      <ArrowUpRightIcon className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                  {item.path && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(locationLabel, item.evidenceId)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {copiedId === item.evidenceId ? (
                        <CheckIcon className="size-3.5 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <CopyIcon className="size-3.5" aria-hidden="true" />
                      )}
                      <span className="sr-only">{copy("decision.copyPath")}</span>
                    </Button>
                  )}

                  {item.supportedCriterionId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigateToObligation?.(item.supportedCriterionId)}
                      className="h-7 text-xs gap-1 font-medium"
                    >
                      <span>{copy("decision.jumpToObligation")}</span>
                      <ArrowUpRightIcon className="size-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Role in Compliance Assessment */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{copy("decision.evidenceRole")}:</span>
                <span>{item.role}</span>
              </div>

              {/* Code Excerpt or Inspection Scopes */}
              {item.excerpt && (
                <div className="rounded-md border border-border/60 bg-muted/40 p-2.5 font-mono text-xs leading-relaxed overflow-x-auto">
                  <pre className="whitespace-pre">{item.excerpt}</pre>
                </div>
              )}

              {/* Search coverage scopes and queries */}
              {item.scopes && item.scopes.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{copy("decision.searchScopes")} </span>
                  <span className="font-mono">{item.scopes.join(", ")}</span>
                </div>
              )}

              {item.queries && item.queries.length > 0 && (
                <div className="flex flex-col gap-1 text-xs">
                  {item.queries.map((q, qIdx) => (
                    <div key={qIdx} className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <span className="font-semibold text-primary">{q.tool}:</span>
                      <span className="truncate">&quot;{q.query}&quot;</span>
                      <span>({copy("decision.searchResults", { count: q.resultCount })})</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
