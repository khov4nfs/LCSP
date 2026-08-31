"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { resolveMessage } from "@lcsp/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusCard } from "@/components/organisms/status-card";
import { appLocale } from "@/lib/locale";
import {
  useGenerateReadinessExportMutation,
  useReadinessStatusQuery,
} from "@/lib/api/assessment-queries";
import type { ReadinessStatusPageProps } from "../../types/component-props.types";
import { RepositoryReadinessAction } from "../molecules/repository-readiness-action";
import { UnresolvedUnknownPanel } from "../molecules/unresolved-unknown-panel";

export function ReadinessStatusPage({
  assessmentId,
}: ReadinessStatusPageProps) {
  const router = useRouter();
  const readinessQuery = useReadinessStatusQuery(assessmentId);
  const exportMutation = useGenerateReadinessExportMutation(assessmentId);

  useEffect(() => {
    if (readinessQuery.data?.kind === "redirect") {
      router.replace(readinessQuery.data.location);
    }
  }, [readinessQuery.data, router]);

  useEffect(() => {
    if (exportMutation.data?.kind === "redirect") {
      router.replace(exportMutation.data.location);
    }
    if (exportMutation.data?.kind === "created") {
      window.location.assign(exportMutation.data.data.downloadUrl);
    }
  }, [exportMutation.data, router]);

  const headingDescription = useMemo(
    () => t("pages.readiness.pageDescription"),
    [],
  );

  if (readinessQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {t("pages.readiness.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{headingDescription}</p>
        </header>
        <StatusCard
          title={t("pages.readiness.pageTitle")}
          description={t("pages.readiness.loadingDetail")}
          badgeLabel={t("pages.readiness.badgeReadinessOnly")}
          badgeVariant="secondary"
        >
          <div className="py-2 text-sm text-muted-foreground">
            {t("pages.readiness.loading")}
          </div>
        </StatusCard>
      </div>
    );
  }

  const viewModel =
    readinessQuery.data?.kind === "loaded" ? readinessQuery.data.data : null;
  const error =
    readinessQuery.data?.kind === "error"
      ? t(readinessQuery.data.titleKey)
      : null;
  const exportError =
    exportMutation.data?.kind === "error"
      ? t(exportMutation.data.detailKey)
      : null;

  if (error || !viewModel) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {t("pages.readiness.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{headingDescription}</p>
        </header>
        <Alert variant="destructive">
          <AlertTitle>{t("pages.readiness.errorTitle")}</AlertTitle>
          <AlertDescription>
            {error ?? t("pages.readiness.errorDetail")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const needsRepositoryConnection = viewModel.missingEvidence.some(
    (item) => item.type === "repository_connection",
  );
  const needsRepositoryAnalysis = viewModel.missingEvidence.some(
    (item) => item.type === "technical_evidence",
  );
  const shouldShowRepositoryAction =
    needsRepositoryConnection || needsRepositoryAnalysis;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {t("pages.readiness.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{headingDescription}</p>
      </header>

      <StatusCard
        title={t("pages.readiness.summaryTitle")}
        description={t(
          viewModel.classificationLocked
            ? "pages.readiness.summaryDescription"
            : "pages.readiness.summaryDescriptionReady",
        )}
        badgeLabel={
          viewModel.classificationLocked
            ? t("pages.readiness.badgeLocked")
            : t("pages.readiness.badgeReady")
        }
        badgeVariant={viewModel.classificationLocked ? "secondary" : "default"}
      >
        <div className="flex flex-wrap gap-2">
          {viewModel.classificationLocked && (
            <Badge variant="outline">
              {t("pages.readiness.badgeReadinessOnly")}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {t("pages.readiness.updatedAtLabel")}: {" "}
            {formatDate(viewModel.updatedAt)}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border bg-muted/30 p-4">
            <h2 className="text-sm font-medium">
              {t("pages.readiness.completedTitle")}
            </h2>
            {viewModel.completedSteps.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
                {viewModel.completedSteps.map((step) => (
                  <li key={step}>• {mapCompletedStep(step)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("pages.readiness.noCompletedSteps")}
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-muted/30 p-4">
            <h2 className="text-sm font-medium">
              {t("pages.readiness.missingTitle")}
            </h2>
            {viewModel.missingEvidence.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
                {viewModel.missingEvidence.map((item) => (
                  <li key={item.type}>
                    <p className="font-medium text-foreground">{item.label}</p>
                    <p>{mapMissingEvidence(item.type, item.description)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("pages.readiness.noMissingEvidence")}
              </p>
            )}
          </section>
        </div>

        {viewModel.unresolvedUnknowns.length > 0 && (
          <UnresolvedUnknownPanel items={viewModel.unresolvedUnknowns} />
        )}

        <section className="rounded-lg border border-dashed p-4">
          <h2 className="text-sm font-medium">
            {t("pages.readiness.nextActionTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {viewModel.nextAction}
          </p>
        </section>

        {shouldShowRepositoryAction ? (
          <RepositoryReadinessAction
            assessmentId={assessmentId}
            repositoryConnection={viewModel.repositoryConnection}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          {viewModel.classificationLocked && (
            <Button
              type="button"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending
                ? t("pages.readiness.actions.exportingPdf")
                : t("pages.readiness.actions.downloadPdf")}
            </Button>
          )}
          <Button
            render={<Link href="/workspace" />}
            variant="outline"
            nativeButton={false}
          >
            {t("pages.readiness.actions.backToWorkspace")}
          </Button>

          {needsRepositoryConnection && (
            <Button
              render={<Link href={`/assessments/${assessmentId}/wizard`} />}
              variant="outline"
              nativeButton={false}
            >
              {t("pages.readiness.actions.editWizard")}
            </Button>
          )}

          {viewModel.classificationLocked ? (
            <div className="flex items-center rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground">
              {t("pages.readiness.classificationLockedReason")}
            </div>
          ) : (
            <Button
              render={
                <Link href={`/assessments/${assessmentId}/classification`} />
              }
              nativeButton={false}
            >
              {t("pages.readiness.actions.openClassification")}
            </Button>
          )}

          <Button
            render={<Link href={`/assessments/${assessmentId}/documents`} />}
            variant="outline"
            nativeButton={false}
          >
            {t("pages.readiness.actions.openDocuments")}
          </Button>
        </div>

        {exportError && (
          <Alert variant="destructive">
            <AlertTitle>{t("pages.readiness.exportErrorTitle")}</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}
      </StatusCard>
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function mapCompletedStep(step: string) {
  switch (step) {
    case "wizard_profile":
      return t("pages.readiness.completedSteps.wizardProfile");
    case "repository_connected":
      return t("pages.readiness.completedSteps.repositoryConnected");
    case "technical_evidence_accepted":
      return t("pages.readiness.completedSteps.technicalEvidenceAccepted");
    default:
      return step;
  }
}

function mapMissingEvidence(type: string, fallback: string) {
  switch (type) {
    case "repository_connection":
      return t("pages.readiness.missingEvidence.repositoryConnection");
    case "technical_evidence":
      return t("pages.readiness.missingEvidence.technicalEvidence");
    default:
      return fallback;
  }
}
