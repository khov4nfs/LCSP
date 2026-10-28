"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LEGAL_SOURCE_STATUS_MESSAGE_KEYS,
} from "../../config/legal-source-display.config";
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
  useActivateLegalSourceVersionMutation,
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
import { LegalSourceDocumentTable } from "./legal-source-document-table";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceVersionPage({ versionId }: { versionId: string }) {
  const query = useLegalSourceVersionQuery(versionId);
  const activate = useActivateLegalSourceVersionMutation(versionId);
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

  async function activateVersion() {
    try {
      await activate.mutateAsync();
      setActivateOpen(false);
      setErrorKey(null);
    } catch (error) {
      setErrorKey(legalSourceErrorMessageKey(error));
    }
  }

  async function discardVersion() {
    try {
      await discard.mutateAsync();
      setDiscardOpen(false);
      setDiscarded(true);
    } catch (error) {
      setErrorKey(legalSourceErrorMessageKey(error));
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
          {version.canActivate ? (
            <Button type="button" onClick={() => setActivateOpen(true)}>
              {t("pages.legalSources.activate")}
            </Button>
          ) : null}
          {version.canDiscard ? (
            <Button
              type="button"
              variant="destructive"
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
          {version.index ? (
            <>
              <SummaryCode
                labelKey="pages.legalSources.contentHashLabel"
                value={version.index.contentHash}
              />
              {version.index.validatedAt ? (
                <SummaryValue
                  labelKey="pages.legalSources.validatedAtLabel"
                  value={formatDate(version.index.validatedAt)}
                />
              ) : null}
            </>
          ) : null}
          {version.activatedAt ? (
            <SummaryValue
              labelKey="pages.legalSources.activatedAtLabel"
              value={formatDate(version.activatedAt)}
            />
          ) : null}
          <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
            <span className="text-sm font-medium">
              {t("pages.legalSources.blockersLabel")}
            </span>
            <LegalSourceBlockerList blockers={version.blockers} />
          </div>
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
          canEditEffect={version.status === LEGAL_SOURCE_LIFECYCLE_STATUSES.draft}
          onError={setErrorKey}
        />
      </section>
      {version.canAddDocuments ? (
        <LegalSourceAddDocumentPanel versionId={version.id} />
      ) : null}
      <LegalSourceConfirmDialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        titleKey="pages.legalSources.activateTitle"
        descriptionKey="pages.legalSources.activateDescription"
        confirmKey="pages.legalSources.confirmActivate"
        pendingKey="pages.legalSources.activating"
        pending={activate.isPending}
        onConfirm={() => void activateVersion()}
      />
      <LegalSourceConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        titleKey="pages.legalSources.discardTitle"
        descriptionKey="pages.legalSources.discardDescription"
        confirmKey="pages.legalSources.confirmDiscard"
        pendingKey="pages.legalSources.discarding"
        pending={discard.isPending}
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

function SummaryCode({ labelKey, value }: { labelKey: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{t(labelKey)}</span>
      <code className="break-all font-mono text-xs">{value}</code>
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
