"use client";

import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import { resolveMessage } from "@lcsp/i18n";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AgentMessage,
  AgentTurn,
  ThoughtLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { appLocale } from "@/lib/locale";

import type { RepositorySetupFormData } from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import {
  REPOSITORY_ENTRY_INTENTS,
  type RepositoryEntryIntent,
} from "../../types/repository-setup-conversation.types";

type RepositoryDetailsTurnProps = {
  provider: GitProviderValue;
  intent: RepositoryEntryIntent;
  repositoryPreview?: string;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onBackToProviders: () => void;
  onBackToRepositories?: () => void;
  onConfigureProvider?: () => void;
};

export function RepositoryDetailsTurn({
  provider,
  intent,
  repositoryPreview,
  canSubmit,
  submitting,
  onSubmit,
  onBackToProviders,
  onBackToRepositories,
  onConfigureProvider,
}: RepositoryDetailsTurnProps) {
  const { register } = useFormContext<RepositorySetupFormData>();
  const providerLabel = formatProvider(provider);
  const actionKey =
    intent === REPOSITORY_ENTRY_INTENTS.edit
      ? "pages.assessmentFlow.replaceRepositoryAction"
      : "pages.assessmentFlow.addRepositoryAction";

  return (
    <AgentTurn>
      <AgentMessage>
        <ThoughtLine
          label={t("pages.assessmentFlow.thinking.completedWithoutDuration")}
        />
        <p className="mt-2">
          {t("pages.assessmentFlow.addRepositoryDescription")}
        </p>
      </AgentMessage>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{providerLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("pages.assessmentFlow.providerSelected")}
          </p>
        </div>
        <span className="rounded-sm bg-primary/15 px-2 py-1 text-xs font-medium text-primary">
          {t("pages.assessmentFlow.selected")}
        </span>
      </div>

      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="block text-sm font-medium" htmlFor="repository-url">
          {t("pages.assessmentFlow.repositoryUrlLabel")}
          <Input
            className="mt-2"
            id="repository-url"
            placeholder={t("pages.assessmentFlow.repositoryPlaceholder")}
            disabled={submitting}
            {...register("repositoryUrl")}
          />
        </label>
        <label
          className="block text-sm font-medium"
          htmlFor="repository-branch"
        >
          {t("pages.assessmentFlow.graph.branch")}
          <Input
            className="mt-2"
            id="repository-branch"
            placeholder={t("pages.assessmentFlow.repository.pending")}
            disabled={submitting}
            {...register("branch")}
          />
        </label>

        {repositoryPreview ? (
          <div className="rounded-md border p-3 text-sm" aria-live="polite">
            <p className="font-medium">{repositoryPreview}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pages.assessmentFlow.repositoryPreviewDescription")}
            </p>
          </div>
        ) : null}

        {!canSubmit && onConfigureProvider ? (
          <Button type="button" variant="outline" onClick={onConfigureProvider}>
            {t("pages.assessmentFlow.configureProvider")}
          </Button>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canSubmit || submitting}>
            {t(actionKey)}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onBackToProviders}
          >
            {t("pages.assessmentFlow.backToProviders")}
          </Button>
          {onBackToRepositories ? (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onBackToRepositories}
            >
              {t("pages.assessmentFlow.backToRepositories")}
            </Button>
          ) : null}
        </div>
      </form>
    </AgentTurn>
  );
}

function formatProvider(provider: GitProviderValue) {
  const key =
    provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
      ? "github"
      : provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab
        ? "gitlab"
        : provider === ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket
          ? "bitbucket"
          : "azureDevOps";
  return t(`pages.assessmentFlow.providers.${key}`);
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
