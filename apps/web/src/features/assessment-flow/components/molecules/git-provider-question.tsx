"use client";

import { resolveMessage } from "@lcsp/i18n";

import { ChatSingleSelect } from "@/features/workspace/components/molecules/chat-single-select";
import { appLocale } from "@/lib/locale";

import { GIT_PROVIDER_OPTIONS } from "../../config/git-provider-options";
import type { GitProviderValue } from "../../types/assessment-flow.types";

type GitProviderQuestionProps = {
  value?: GitProviderValue;
  capabilities?: Array<{
    provider: string;
    canConnect: boolean;
    canPinSnapshot: boolean;
  }>;
  onValueChange: (value: GitProviderValue) => void;
  disabled?: boolean;
};

export function GitProviderQuestion({
  value,
  capabilities,
  onValueChange,
  disabled,
}: GitProviderQuestionProps) {
  return (
    <ChatSingleSelect
      value={value}
      disabled={disabled}
      ariaLabel={t("pages.assessmentFlow.providerQuestion")}
      options={GIT_PROVIDER_OPTIONS.map((option) => {
        const capability = capabilities?.find(
          (item) => item.provider === option.id,
        );
        const available =
          option.supported &&
          (capability
            ? capability.canConnect && capability.canPinSnapshot
            : true);
        return {
          id: option.id,
          label: t(option.labelKey),
          disabled: !available,
          assistiveText: available
            ? undefined
            : t("pages.assessmentFlow.providerComingSoon"),
        };
      })}
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
