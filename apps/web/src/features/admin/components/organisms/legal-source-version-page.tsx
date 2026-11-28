"use client";

import { useState } from "react";
import Link from "next/link";
import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";
import {
  LEGAL_RETRIEVAL_INDEX_STATUSES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useLegalSourceQuery,
  useDiscardLegalSourceVersionMutation,
  useLegalSourceVersionQuery,
} from "@/lib/api/legal-source-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import { LegalSourceLifecycleBadge } from "../atoms/legal-source-lifecycle-badge";
import { LegalSourceAddDocumentPanel } from "../molecules/legal-source-add-document-panel";
import { LegalSourceBlockerList } from "../molecules/legal-source-blocker-list";
import { LegalSourceConfirmDialog } from "../molecules/legal-source-confirm-dialog";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { LegalSourceActivationDialog } from "../molecules/legal-source-activation-dialog";
import { LegalSourceDocumentTable } from "./legal-source-document-table";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Business purpose: Present one immutable version identity with documents, lineage and guarded lifecycle review.
 * Business rules: Use server capability flags for document/discard operations; active and historical versions are read-only. LCSP-424/425 admission is absent from the management contract, so activation review cannot submit activation.
 * Execution flow:
 * 1. Load the selected version and its parent source lineage.
 * 2. Present documents and technical status, then delegate draft mutations and explicit confirmations.
 * 3. Show errors without fabricating successful lifecycle transitions.
 * Failure cases: Failed loading renders retry; stale requests cannot confirm discard; missing admission keeps activation disabled.
 * Side effects: Reads cached API data and delegates audited mutations to domain query hooks.
 */
export function LegalSourceVersionPage({ versionId }: { versionId: string }) {
  const query = useLegalSourceVersionQuery(versionId);
  const sourceQuery = useLegalSourceQuery(query.data?.source.id ?? "");
  const discard = useDiscardLegalSourceVersionMutation(versionId);
  const [activateOpen, setActivateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState(false);

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalSources.loadFailed")}</span>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("pages.legalSources.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const version = query.data;
  if (discarded) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t("pages.legalSources.draftDiscarded")}</span>
            <Link
              href={`/admin/legal-sources/${encodeURIComponent(version.source.id)}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {t("pages.legalSources.sourceLink")}
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  const indexValid =
    version.index?.status === LEGAL_RETRIEVAL_INDEX_STATUSES.VALID;

  /**
   * Business purpose: Discard the selected unused draft only after explicit confirmation.
   * Business rules: Require current server canDiscard eligibility; the server rechecks references and authorization.
   * Execution flow:
   * 1. Refuse stale or ineligible client state.
   * 2. Submit discard and show the source return link only after server success.
   * Failure cases: Server rejection preserves the draft view and exposes the canonical error.
   * Side effects: Calls the audited discard endpoint and updates local confirmation/result state.
   */
  async function discardVersion() {
    if (!version.canDiscard || query.isFetching || query.isError) return;
    try {
      await discard.mutateAsync();
      setDiscardOpen(false);
      setDiscarded(true);
    } catch (error) {
      setErrorKey(legalSourceErrorMessageKey(error));
      void query.refetch();
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Link
        href={`/admin/legal-sources/${encodeURIComponent(version.source.id)}`}
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("pages.legalSources.sourceLink")}: {version.source.name}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {t("pages.legalSources.versionLabel")} {version.version}
          </h1>
          <LegalSourceLifecycleBadge status={version.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {version.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setActivateOpen(true)}
            >
              {t("pages.legalLifecycle.reviewActivation")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t(
              query.isFetching
                ? "pages.legalLifecycle.refreshing"
                : "pages.legalLifecycle.refresh",
            )}
          </Button>
          {version.canDiscard ? (
            <Button
              type="button"
              variant="destructive"
              disabled={query.isFetching || discard.isPending}
              onClick={() => setDiscardOpen(true)}
            >
              {t("pages.legalSources.discardDraft")}
            </Button>
          ) : null}
        </div>
      </div>
      {errorKey ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t(errorKey)}</span>
            <Button
              variant="ghost"
              onClick={() => setErrorKey(null)}
              aria-label={t("pages.legalSources.cancel")}
            >
              {t("pages.legalSources.cancel")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t("pages.legalLifecycle.versionDescription")}
      </p>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="bg-primary text-primary-foreground lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("pages.legalSources.versionSummary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold">
              {t("pages.legalSources.versionLabel")} {version.version}
            </p>
            <p>{statusLabel(version.status)}</p>
            <p>
              {t("pages.legalLifecycle.basedOn")}:{" "}
              {sourceQuery.data?.versions.find(
                (v) => v.id === version.basedOnVersionId,
              )?.version ??
                version.basedOnVersionId ??
                t("pages.legalLifecycle.notRecorded")}
            </p>
            <p>
              {t("pages.legalLifecycle.activeVersion")}:{" "}
              {sourceQuery.data?.activeVersion?.version ??
                t("pages.legalLifecycle.notRecorded")}
            </p>
            <dl className="space-y-2 break-all text-xs">
              <div>
                <dt>{t("pages.legalLifecycle.sourceId")}</dt>
                <dd>{version.source.id}</dd>
              </div>
              <div>
                <dt>{t("pages.legalLifecycle.versionId")}</dt>
                <dd>{version.id}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("pages.legalLifecycle.draftManagement")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-medium">{version.source.name}</p>
            <p className="text-sm text-muted-foreground">
              {t("pages.legalLifecycle.draftNotice")}
            </p>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <SummaryValue
                labelKey="pages.legalSources.documentCountLabel"
                value={String(version.documentCount)}
              />
              <SummaryValue
                labelKey="pages.legalSources.readyDocumentCountLabel"
                value={String(version.readyDocumentCount)}
              />
              <SummaryValue
                labelKey="pages.legalSources.chunkCountLabel"
                value={String(version.chunkCount)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("pages.legalLifecycle.admissionMissing")}
            </p>
          </CardContent>
        </Card>
      </div>
      {version.status !== LEGAL_SOURCE_LIFECYCLE_STATUSES.draft ? (
        <Alert>
          <AlertDescription>
            <span className="font-medium">
              {t("pages.legalSources.immutableNotice")}
            </span>{" "}
            {t("pages.legalSources.immutableDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t("pages.legalSources.documentsTitle")}
        </h2>
        <LegalSourceDocumentTable
          versionId={version.id}
          documents={version.documents}
          canEditEffect={
            version.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft
          }
          onError={setErrorKey}
        />
      </section>
      {version.canAddDocuments ? (
        <LegalSourceAddDocumentPanel versionId={version.id} />
      ) : null}
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer font-medium">
          {t("pages.legalSources.versionSummary")}
        </summary>
        <Card>
          <CardHeader>
            <CardTitle>{t("pages.legalSources.versionSummary")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <SummaryValue
              labelKey="pages.legalSources.sourceLabel"
              value={version.source.name}
            />
            <SummaryValue
              labelKey="pages.legalSources.statusLabel"
              value={statusLabel(version.status)}
            />
            <SummaryValue
              labelKey="pages.legalSources.documentCountLabel"
              value={String(version.documentCount)}
            />
            <SummaryValue
              labelKey="pages.legalSources.readyDocumentCountLabel"
              value={String(version.readyDocumentCount)}
            />
            <SummaryValue
              labelKey="pages.legalSources.chunkCountLabel"
              value={String(version.chunkCount)}
            />
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {t("pages.legalSources.indexLabel")}
              </span>
              <span
                className={
                  indexValid
                    ? "text-sm font-medium text-emerald-700 dark:text-emerald-300"
                    : "text-sm font-medium text-destructive"
                }
              >
                {t(
                  indexValid
                    ? "pages.legalSources.indexValid"
                    : "pages.legalSources.indexInvalid",
                )}
              </span>
            </div>
            {version.index?.validatedAt ? (
              <SummaryValue
                labelKey="pages.legalSources.validatedAtLabel"
                value={formatDate(version.index.validatedAt)}
              />
            ) : null}
            {version.activatedAt ? (
              <SummaryValue
                labelKey="pages.legalSources.activatedAtLabel"
                value={formatDate(version.activatedAt)}
              />
            ) : null}
            {version.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft &&
            version.blockers.length > 0 ? (
              <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
                <span className="text-sm font-medium">
                  {t("pages.legalSources.blockersLabel")}
                </span>
                <LegalSourceBlockerList blockers={version.blockers} />
              </div>
            ) : null}
            {version.ruleSetCount > 0 ? (
              <p className="text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                {formatAppMessage(
                  "pages.legalSources.ruleSetReferenceCount" as MessageKey,
                  {
                    count: version.ruleSetCount,
                  },
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </details>
      <LegalSourceActivationDialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        version={version}
        activeVersion={sourceQuery.data?.activeVersion?.version}
      />
      <LegalSourceConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        titleKey="pages.legalSources.discardTitle"
        descriptionKey="pages.legalSources.discardDescription"
        confirmKey="pages.legalSources.confirmDiscard"
        pendingKey="pages.legalSources.discarding"
        pending={discard.isPending}
        disabled={!version.canDiscard || query.isFetching || query.isError}
        context={`${version.source.name} ? ${version.version} ? ${version.id}`}
        destructive
        onConfirm={() => void discardVersion()}
      />
    </div>
  );
}

function SummaryValue({
  labelKey,
  value,
}: {
  labelKey: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{t(labelKey)}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  const messageKey = Object.entries(LEGAL_SOURCE_STATUS_MESSAGE_KEYS).find(
    ([value]) => value === status,
  )?.[1];
  return t(messageKey ?? "pages.legalSources.statuses.INVALID");
}
