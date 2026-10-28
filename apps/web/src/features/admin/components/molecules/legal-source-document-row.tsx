"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import {
  LEGAL_SOURCE_DOCUMENT_ORIGINS,
  LEGAL_SOURCE_DOCUMENT_FAILURE_CODES,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  type LegalSourceDocumentFailureCode,
  type LegalSourceDocumentView,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import {
  useRemoveLegalSourceDocumentMutation,
  useRetryLegalSourceDocumentMutation,
} from "@/lib/api/legal-source-queries";
import { appLocale } from "@/lib/locale";
import {
  LEGAL_SOURCE_FAILURE_MESSAGE_KEYS,
  LEGAL_SOURCE_ORIGIN_MESSAGE_KEYS,
  LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS,
} from "../../config/legal-source-display.config";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { LegalSourceConfirmDialog } from "./legal-source-confirm-dialog";
import { LegalSourceEffectMetadataDialog } from "./legal-source-effect-metadata-dialog";
import { LegalSourceIngestionBadge } from "../atoms/legal-source-ingestion-badge";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceDocumentRow({
  versionId,
  document,
  canEditEffect,
  onError,
}: {
  versionId: string;
  document: LegalSourceDocumentView;
  canEditEffect: boolean;
  onError: (key: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editEffect, setEditEffect] = useState(false);
  const [copied, setCopied] = useState(false);
  const retry = useRetryLegalSourceDocumentMutation(versionId);
  const remove = useRemoveLegalSourceDocumentMutation(versionId);

  async function retryDocument() {
    try {
      await retry.mutateAsync(document.id);
    } catch (error) {
      onError(legalSourceErrorMessageKey(error));
    }
  }

  async function removeDocument() {
    try {
      await remove.mutateAsync(document.id);
      setConfirmRemove(false);
    } catch (error) {
      onError(legalSourceErrorMessageKey(error));
    }
  }

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(document.sourceSha256);
      setCopied(true);
    } catch {
      onError("pages.legalSources.actionFailed");
    }
  }

  const adminDocumentPath = `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(document.id)}`;
  const usedProfile = getStructureProfile(
    document.extraction,
    document.structureProfile,
  );
  const failureKey = getFailureKey(document.failureCode);

  return (
    <tr>
      <td className="min-w-56 px-4 py-4 align-top">
        <div className="flex flex-col gap-2">
          <span className="font-medium">{document.title}</span>
          <LegalSourceIngestionBadge state={document.ingestionState} />
          {failureKey ? (
            <span className="text-sm text-destructive">{t(failureKey)}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {t("pages.legalSources.sourceEffectStatusLabel")}:{" "}
            {document.sourceEffectStatus}
            {document.effectiveDate ? ` · ${document.effectiveDate}` : ""}
          </span>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        {t(LEGAL_SOURCE_ORIGIN_MESSAGE_KEYS[document.origin] as MessageKey)}
        {document.origin === LEGAL_SOURCE_DOCUMENT_ORIGINS.URL_IMPORT ? (
          <LegalSourceProvenance document={document} />
        ) : null}
      </td>
      <td className="px-4 py-4 align-top text-xs">
        <span>{document.mediaType ?? "—"}</span>
        {usedProfile ? (
          <span className="mt-1 block text-muted-foreground">
            {t("pages.legalSources.structureProfileUsedLabel")}:{" "}
            {t(usedProfile as MessageKey)}
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-4 py-4 align-top">
        {formatBytes(document.byteLength)}
      </td>
      <td className="px-4 py-4 align-top">{document.chunkCount}</td>
      <td className="min-w-72 px-4 py-4 align-top">
        <div className="flex items-center gap-2">
          <code className="break-all font-mono text-xs">
            {document.sourceSha256}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("pages.legalSources.copySha256")}
            onClick={() => void copyHash()}
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </div>
        {copied ? (
          <span className="text-xs text-muted-foreground">
            {t("pages.legalSources.copySuccess")}
          </span>
        ) : null}
      </td>
      <td className="min-w-52 px-4 py-4 align-top">
        <div className="flex flex-wrap gap-2">
          {canEditEffect &&
          document.ingestionState ===
            LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.READY ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditEffect(true)}
            >
              {t("pages.legalSources.editEffectStatus")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={`/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(document.id)}`}
              />
            }
          >
            <EyeIcon aria-hidden="true" />
            {t("pages.legalSources.inspectChunks")}
          </Button>
          {document.hasOriginal ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={`${adminDocumentPath}/original`} download />}
            >
              <DownloadIcon aria-hidden="true" />
              {t("pages.legalSources.downloadOriginal")}
            </Button>
          ) : null}
          {document.canRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retry.isPending}
              onClick={() => void retryDocument()}
            >
              <RotateCwIcon aria-hidden="true" />
              {t(
                retry.isPending
                  ? "pages.legalSources.retryingDocument"
                  : "pages.legalSources.retryDocument",
              )}
            </Button>
          ) : null}
          {document.canRemove ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2Icon aria-hidden="true" />
              {t("pages.legalSources.removeDocument")}
            </Button>
          ) : null}
        </div>
        <LegalSourceConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          titleKey="pages.legalSources.removeTitle"
          descriptionKey="pages.legalSources.removeDescription"
          confirmKey="pages.legalSources.confirmRemove"
          pendingKey="pages.legalSources.removingDocument"
          pending={remove.isPending}
          destructive
          onConfirm={() => void removeDocument()}
        />
        <LegalSourceEffectMetadataDialog
          versionId={versionId}
          document={document}
          open={editEffect}
          onOpenChange={setEditEffect}
          onError={onError}
        />
      </td>
    </tr>
  );
}

function LegalSourceProvenance({
  document,
}: {
  document: LegalSourceDocumentView;
}) {
  const provenance = document.provenance;
  if (!provenance) return null;
  const requested = valueOf(provenance, "requestedUrl");
  const finalUrl = valueOf(provenance, "finalUrl");
  const retrievedAt = valueOf(provenance, "retrievedAt");
  const httpStatus = valueOf(provenance, "httpStatus");
  const redirects = valueOf(provenance, "redirects");
  return (
    <details className="mt-2 max-w-64 text-xs">
      <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
        {t("pages.legalSources.provenanceTitle")}
      </summary>
      <dl className="mt-2 flex flex-col gap-1 text-muted-foreground">
        {requested ? (
          <LegalSourceProvenanceValue
            labelKey="pages.legalSources.requestedUrlLabel"
            value={requested}
          />
        ) : null}
        {finalUrl ? (
          <LegalSourceProvenanceValue
            labelKey="pages.legalSources.finalUrlLabel"
            value={finalUrl}
          />
        ) : null}
        {retrievedAt ? (
          <LegalSourceProvenanceValue
            labelKey="pages.legalSources.retrievedAtLabel"
            value={retrievedAt}
          />
        ) : null}
        {httpStatus ? (
          <LegalSourceProvenanceValue
            labelKey="pages.legalSources.httpStatusLabel"
            value={httpStatus}
          />
        ) : null}
        {redirects ? (
          <LegalSourceProvenanceValue
            labelKey="pages.legalSources.redirectsLabel"
            value={redirects}
          />
        ) : null}
      </dl>
    </details>
  );
}

function LegalSourceProvenanceValue({
  labelKey,
  value,
}: {
  labelKey: string;
  value: string;
}) {
  return (
    <div className="break-words">
      <dt className="font-medium text-foreground">{t(labelKey)}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function valueOf(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function getFailureKey(code: string | null): string | undefined {
  const knownCode = Object.values(LEGAL_SOURCE_DOCUMENT_FAILURE_CODES).find(
    (value) => value === code,
  ) as LegalSourceDocumentFailureCode | undefined;
  return knownCode ? LEGAL_SOURCE_FAILURE_MESSAGE_KEYS[knownCode] : undefined;
}

function getStructureProfile(
  extraction: Record<string, unknown> | null,
  fallback: string | null,
): string | undefined {
  const fromExtraction = extraction?.structureProfile;
  const value = typeof fromExtraction === "string" ? fromExtraction : fallback;
  const knownValue = Object.values(LEGAL_SOURCE_STRUCTURE_PROFILES).find(
    (profile) => profile === value,
  );
  return knownValue
    ? LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS[knownValue]
    : undefined;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return "—";
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat(appLocale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 2,
  }).format(megabytes);
}
