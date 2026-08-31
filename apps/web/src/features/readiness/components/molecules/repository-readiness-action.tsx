"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
} from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  useConnectAssessmentRepositoryMutation,
  useStartRepositoryAnalysisMutation,
} from "@/lib/api/assessment-queries";
import type { AssessmentRepositoryConnection } from "@/lib/api/repository-analysis-client";
import { appLocale } from "@/lib/locale";

import {
  repositoryConnectionSchema,
  type RepositoryConnectionValues,
} from "../../schemas/repository-connection.schema";
import { runRepositoryReadinessAnalysis } from "../../utils/repository-readiness-analysis";

type RepositoryReadinessActionProps = {
  assessmentId: string;
  repositoryConnection: AssessmentRepositoryConnection | null;
};

export function RepositoryReadinessAction({
  assessmentId,
  repositoryConnection,
}: RepositoryReadinessActionProps) {
  const connectMutation = useConnectAssessmentRepositoryMutation(assessmentId);
  const analysisMutation = useStartRepositoryAnalysisMutation(assessmentId);
  const [connectedDuringSession, setConnectedDuringSession] =
    useState<AssessmentRepositoryConnection | null>(null);
  const activeConnection = connectedDuringSession ?? repositoryConnection;
  const form = useForm<RepositoryConnectionValues>({
    resolver: zodResolver(repositoryConnectionSchema),
    defaultValues: { repositoryUrl: "" },
  });

  const pending = connectMutation.isPending || analysisMutation.isPending;
  const requestError = connectMutation.error ?? analysisMutation.error;
  const credentialActionRequired = isCredentialActionRequired(requestError);

  async function analyze(repositoryUrl?: string) {
    connectMutation.reset();
    analysisMutation.reset();
    await runRepositoryReadinessAnalysis(
      { connection: activeConnection, repositoryUrl },
      {
        connect: (url) => connectMutation.mutateAsync(url),
        analyze: (input) => analysisMutation.mutateAsync(input),
        onConnected: (connection) => {
          setConnectedDuringSession(connection);
          form.reset();
        },
      },
    ).catch(() => undefined);
  }

  return (
    <section className="rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-medium">
        {t("pages.readiness.repository.title")}
      </h2>

      {activeConnection ? (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">
              {t("pages.readiness.repository.connected")}
            </p>
            <p className="text-sm text-muted-foreground">
              {activeConnection.repositoryFullName} ·{" "}
              {activeConnection.defaultBranch}
            </p>
          </div>
          {!analysisMutation.isSuccess ? (
            <Button
              type="button"
              className="w-fit"
              disabled={pending}
              onClick={() => void analyze()}
            >
              {analysisMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {analysisMutation.isPending
                ? t("pages.readiness.repository.startingAnalysis")
                : t("pages.readiness.repository.retryAnalysis")}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="mt-3"
          onSubmit={form.handleSubmit((values) =>
            analyze(values.repositoryUrl),
          )}
          noValidate
        >
          <FieldGroup>
            <Field
              data-invalid={
                Boolean(form.formState.errors.repositoryUrl) || undefined
              }
            >
              <FieldLabel htmlFor="readiness-repository-url">
                {t("pages.readiness.repository.urlLabel")}
              </FieldLabel>
              <Input
                id="readiness-repository-url"
                type="url"
                autoComplete="url"
                placeholder={t("pages.readiness.repository.urlPlaceholder")}
                disabled={pending}
                {...form.register("repositoryUrl")}
              />
              <FieldDescription>
                {t("pages.readiness.repository.urlDescription")}
              </FieldDescription>
              {form.formState.errors.repositoryUrl?.message ? (
                <FieldError>
                  {t(form.formState.errors.repositoryUrl.message as MessageKey)}
                </FieldError>
              ) : null}
            </Field>
            <Button type="submit" className="w-fit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {connectMutation.isPending
                ? t("pages.readiness.repository.connecting")
                : analysisMutation.isPending
                  ? t("pages.readiness.repository.startingAnalysis")
                  : t("pages.readiness.repository.connectAndAnalyze")}
            </Button>
          </FieldGroup>
        </form>
      )}

      {analysisMutation.isSuccess ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("pages.readiness.repository.analysisStarted")}
        </p>
      ) : null}

      {requestError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>
            {t(
              activeConnection
                ? "pages.readiness.repository.analysisFailedTitle"
                : "pages.readiness.repository.connectFailedTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            <p>{t(repositoryProblemMessageKey(requestError))}</p>
            {credentialActionRequired ? (
              <Link
                className="mt-2 inline-block underline underline-offset-4"
                href={`/workspace/settings?section=repositories&assessment_id=${encodeURIComponent(assessmentId)}`}
              >
                {t("pages.readiness.repository.configureCredential")}
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

function repositoryProblemMessageKey(error: unknown): MessageKey {
  const code = error instanceof Error ? error.message : undefined;
  switch (code) {
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired:
      return "pages.readiness.repository.credentialRequired";
    case GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid:
      return "pages.readiness.repository.unsupportedUrl";
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid:
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired:
    case GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied:
    case GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable:
      return "pages.readiness.repository.accessFailed";
    default:
      return "pages.readiness.repository.analysisFailed";
  }
}

function isCredentialActionRequired(error: unknown): boolean {
  const code = error instanceof Error ? error.message : undefined;
  return (
    code === GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired ||
    code === GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid ||
    code === GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired
  );
}

function t(key: MessageKey) {
  return resolveMessage(appLocale, key);
}
