"use client";

import { resolveMessage } from "@lcsp/i18n";

import { ChatSingleSelect } from "@/features/workspace/components/molecules/chat-single-select";
import { appLocale } from "@/lib/locale";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";

import { GIT_PROVIDER_OPTIONS } from "../../config/git-provider-options";
import type { GitProviderValue } from "../../types/assessment-flow.types";

type GitProviderQuestionProps = {
  value?: GitProviderValue;
  onValueChange: (value: GitProviderValue) => void;
  disabled?: boolean;
  providerAvailability?: Partial<Record<GitProviderValue, boolean>>;
  providerTemporarilyUnavailable?: Partial<Record<GitProviderValue, boolean>>;
};

/**
 * Business purpose: Let the customer choose a repository provider available in the current deployment.
 * Business rules: GitHub/GitLab keep their existing availability, while Bitbucket/Azure choices require explicit backend readiness.
 * Execution flow: 1. Project provider options with deployment availability. 2. Mark unavailable options disabled. 3. Emit only a recognized provider selection.
 * Failure cases: Missing readiness disables target providers; temporary runtime outages are shown separately from deployment disablement.
 * Side effects: Emits a selection to the existing Assessment setup form; no connection is created here.
 */
export function GitProviderQuestion({
  value,
  onValueChange,
  disabled,
  providerAvailability = {},
  providerTemporarilyUnavailable = {},
}: GitProviderQuestionProps) {
  return (
    <ChatSingleSelect
      value={value}
      disabled={disabled}
      ariaLabel={t("pages.assessmentFlow.providerQuestion")}
      options={GIT_PROVIDER_OPTIONS.map((option) => ({
        id: option.id,
        label: t(option.labelKey),
        disabled:
          !option.supported ||
          (option.id !== ASSESSMENT_REPOSITORY_PROVIDERS.github &&
            option.id !== ASSESSMENT_REPOSITORY_PROVIDERS.gitlab &&
            providerAvailability[option.id] !== true),
        assistiveText:
          option.id === ASSESSMENT_REPOSITORY_PROVIDERS.github ||
          option.id === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab ||
          providerAvailability[option.id] === true
          ? undefined
          : t(
              providerTemporarilyUnavailable[option.id]
                ? "pages.workspace.settingsHub.repositories.providerTemporarilyUnavailable"
                : "pages.assessmentFlow.providerUnavailable",
            ),
      }))}
      onValueChange={(nextValue) => {
        const provider = GIT_PROVIDER_OPTIONS.find(
          (option) => option.id === nextValue,
        );
        if (provider) onValueChange(provider.id);
      }}
    />
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
