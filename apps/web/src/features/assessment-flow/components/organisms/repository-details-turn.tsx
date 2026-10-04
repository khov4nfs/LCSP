"use client";

import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import { resolveMessage } from "@lcsp/i18n";
import Image from "next/image";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import { GIT_PROVIDER_OPTIONS } from "../../config/git-provider-options";
import type { RepositorySetupFormData } from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import {
  REPOSITORY_ENTRY_INTENTS,
  type RepositoryEntryIntent,
} from "../../types/repository-setup-conversation.types";

const PROVIDER_LOGOS: Record<GitProviderValue, string> = {
  [ASSESSMENT_REPOSITORY_PROVIDERS.github]:
    "/assets/figma/settings/logo-github.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]:
    "/assets/figma/settings/logo-gitlab.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket]:
    "/assets/figma/settings/logo-bitbucket.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps]:
    "/assets/figma/settings/logo-azure-devops.svg",
};

type RepositoryDetailsTurnProps = {
  provider?: GitProviderValue;
  providerCapabilities?: Array<{
    provider: string;
    canConnect: boolean;
    canPinSnapshot: boolean;
  }>;
  intent: RepositoryEntryIntent;
  repositoryPreview?: string;
  credentialConfigured: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onProviderChange: (provider: GitProviderValue) => void;
  onBackToRepositories?: () => void;
  onConfigureProvider?: () => void;
};

export function RepositoryDetailsTurn({
  provider,
  providerCapabilities,
  intent,
  repositoryPreview,
  credentialConfigured,
  canSubmit,
  submitting,
  onSubmit,
  onProviderChange,
  onBackToRepositories,
  onConfigureProvider,
}: RepositoryDetailsTurnProps) {
  const { register } = useFormContext<RepositorySetupFormData>();
  const actionKey =
    intent === REPOSITORY_ENTRY_INTENTS.edit
      ? "pages.assessmentFlow.replaceRepositoryAction"
      : "pages.assessmentFlow.addRepositoryAction";

  return (
    <section
      aria-label={t("pages.assessmentFlow.addRepositoryAction")}
      className="w-full max-w-3xl rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t("pages.assessmentFlow.addRepositoryAction")}
      </h2>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("pages.assessmentFlow.addRepositoryDescription")}
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset>
          <legend className="text-sm font-medium">
            {t("pages.assessmentFlow.providerQuestion")}
          </legend>
          <div
            role="radiogroup"
            aria-label={t("pages.assessmentFlow.providerQuestion")}
            className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {GIT_PROVIDER_OPTIONS.map((option) => {
              const capability = providerCapabilities?.find(
                (item) => item.provider === option.id,
              );
              const available =
                option.supported &&
                (capability
                  ? capability.canConnect && capability.canPinSnapshot
                  : true);
              const selected = option.id === provider;

              return (
                <Button
                  key={option.id}
                  data-option-id={option.id}
                  data-selected={selected ? "true" : "false"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={submitting || !available}
                  variant="outline"
                  className={cn(
                    "w-full justify-center gap-2 transition-colors",
                    selected &&
                      "border-primary bg-primary/15 shadow-sm ring-2 ring-primary/30 hover:bg-primary/20",
                  )}
                  onClick={() => onProviderChange(option.id)}
                >
                  <Image
                    src={PROVIDER_LOGOS[option.id]}
                    alt=""
                    aria-hidden="true"
                    width={20}
                    height={20}
                    className="size-5 object-contain"
                  />
                  {t(option.labelKey)}
                </Button>
              );
            })}
          </div>
        </fieldset>

        <label className="block text-sm font-medium" htmlFor="repository-url">
          {t("pages.assessmentFlow.repositoryUrlLabel")}
          {provider ? (
            credentialConfigured || !onConfigureProvider ? (
              <Input
                className="mt-2"
                id="repository-url"
                placeholder={t("pages.assessmentFlow.repositoryPlaceholder")}
                disabled={submitting}
                {...register("repositoryUrl")}
              />
            ) : (
              <Button
                className="mt-2 w-full justify-center"
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={onConfigureProvider}
              >
                {t("pages.assessmentFlow.configureProvider")}
              </Button>
            )
          ) : (
            <Input
              className="mt-2"
              id="repository-url"
              placeholder={t(
                "pages.assessmentFlow.repositoryDisabledPlaceholder",
              )}
              disabled
            />
          )}
        </label>

        {repositoryPreview ? (
          <div className="rounded-md border p-3 text-sm" aria-live="polite">
            <p className="font-medium">{repositoryPreview}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pages.assessmentFlow.repositoryPreviewDescription")}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          {onBackToRepositories ? (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onBackToRepositories}
            >
              {t("pages.assessmentFlow.multiRepository.cancel")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!canSubmit || submitting}>
            {t(actionKey)}
          </Button>
        </div>
      </form>
    </section>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
