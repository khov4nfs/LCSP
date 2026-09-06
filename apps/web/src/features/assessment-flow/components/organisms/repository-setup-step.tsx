"use client";

import {
  ASSESSMENT_REPOSITORY_PROVIDERS,
  type AssessmentRepositoryProvider,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AgentMessage,
  AgentTurn,
  ThoughtLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { TurnFooter } from "@/features/workspace/components/molecules/turn-footer";
import { AssessmentComposer } from "@/features/workspace/components/organisms/assessment-composer";
import { AssessmentTranscript } from "@/features/workspace/components/organisms/assessment-transcript";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import {
  connectAssessmentRepository,
  startRepositoryAnalysis,
} from "@/lib/api/repository-analysis-client";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

import { repositorySetupSchema } from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import { GitProviderQuestion } from "../molecules/git-provider-question";

type RepositorySetupStepProps = {
  assessmentId?: string;
};

export function RepositorySetupStep({
  assessmentId,
}: RepositorySetupStepProps) {
  const router = useRouter();
  const createAssessment = useCreateAssessmentMutation();
  const credentialStatuses = useProviderCredentialStatusesQuery();
  const [provider, setProvider] = useState<GitProviderValue>();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [workingAssessmentId, setWorkingAssessmentId] = useState<
    string | undefined
  >(assessmentId);
  const [errorKey, setErrorKey] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const credentialProvider = toCredentialProvider(provider);
  const credentialConfigured = credentialStatuses.data?.some(
    (status) => status.provider === credentialProvider && status.configured,
  );
  const canEnterRepository = Boolean(
    provider && credentialProvider && credentialConfigured,
  );

  async function handleSubmit() {
    const parsed = repositorySetupSchema.safeParse({
      provider,
      repositoryUrl,
    });
    if (!parsed.success) {
      setErrorKey("pages.assessmentFlow.errors.repositoryUrl");
      return;
    }

    setIsSubmitting(true);
    setErrorKey(undefined);
    try {
      let assessmentId = workingAssessmentId;
      if (!assessmentId) {
        const outcome = await createAssessment.mutateAsync({
          name: assessmentNameFromUrl(parsed.data.repositoryUrl),
        });
        if (outcome.kind !== API_OUTCOME_KINDS.created) {
          setErrorKey("pages.assessmentFlow.errors.createAssessment");
          return;
        }
        assessmentId = outcome.assessmentId;
        setWorkingAssessmentId(assessmentId);
      }

      const connection = await connectAssessmentRepository(
        assessmentId,
        parsed.data.repositoryUrl,
      );
      await startRepositoryAnalysis(assessmentId, {
        connectionId: connection.connectionId,
        branch: connection.defaultBranch,
      });
      router.replace(`/assessments/${assessmentId}`);
    } catch {
      setErrorKey("pages.assessmentFlow.errors.repositorySetup");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-surface="repository-setup"
    >
      <AssessmentTranscript autoScrollKey={[provider, errorKey].join(":")}>
        <AgentTurn
          content={
            <AgentMessage>
              <ThoughtLine label={t("pages.assessmentFlow.thought")} />
              <p className="mt-2">
                {t("pages.assessmentFlow.repositorySetupDescription")}
              </p>
              <p className="mt-3 font-medium">
                {t("pages.assessmentFlow.providerQuestion")}
              </p>
              <p className="text-muted-foreground">
                {t("pages.assessmentFlow.providerHelp")}
              </p>
            </AgentMessage>
          }
          terminalAction={
            <GitProviderQuestion
              value={provider}
              onValueChange={(value) => {
                setProvider(value);
                setRepositoryUrl("");
                setErrorKey(undefined);
              }}
              disabled={isSubmitting}
            />
          }
          footer={
            provider && credentialProvider && !credentialConfigured ? (
              <TurnFooter
                actions={[
                  {
                    id: "configure-provider",
                    label: t("pages.assessmentFlow.configureProvider"),
                    onSelect: () =>
                      router.push("/workspace/settings?section=repositories"),
                  },
                ]}
              />
            ) : undefined
          }
        />
        {errorKey ? (
          <AgentTurn>
            <Alert variant="destructive">
              <AlertTitle>{t("pages.assessmentFlow.errors.title")}</AlertTitle>
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          </AgentTurn>
        ) : null}
      </AssessmentTranscript>
      <AssessmentComposer
        value={repositoryUrl}
        onValueChange={setRepositoryUrl}
        onSubmit={handleSubmit}
        disabled={!canEnterRepository}
        submitting={isSubmitting}
        placeholder={t(
          canEnterRepository
            ? "pages.assessmentFlow.repositoryPlaceholder"
            : "pages.assessmentFlow.repositoryDisabledPlaceholder",
        )}
      />
    </main>
  );
}

function toCredentialProvider(
  provider?: AssessmentRepositoryProvider,
): CredentialProvider | undefined {
  if (provider === ASSESSMENT_REPOSITORY_PROVIDERS.github) {
    return CREDENTIAL_PROVIDERS.github;
  }
  if (provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab) {
    return CREDENTIAL_PROVIDERS.gitlab;
  }
  return undefined;
}

function assessmentNameFromUrl(repositoryUrl: string) {
  const pathname = new URL(repositoryUrl).pathname.replace(/\.git$/u, "");
  return pathname.split("/").filter(Boolean).slice(-2).join("/");
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
