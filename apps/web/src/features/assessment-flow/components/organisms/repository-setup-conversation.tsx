"use client";

import { resolveMessage } from "@lcsp/i18n";

import {
  AgentMessage,
  AgentTurn,
  ThoughtLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { ASSESSMENT_CHAT_ROLES } from "@/features/workspace/types/assessment-chat.types";
import { appLocale } from "@/lib/locale";

import type { RepositorySetupConversationProps } from "../../types/repository-setup-conversation.types";
import { GitProviderQuestion } from "../molecules/git-provider-question";

export function RepositorySetupConversation({
  provider,
  repositoryUrl,
  onProviderChange,
  disabled,
  footer,
}: RepositorySetupConversationProps) {
  return (
    <>
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
            onValueChange={onProviderChange ?? (() => undefined)}
            disabled={disabled || !onProviderChange}
          />
        }
        footer={footer}
      />
      {repositoryUrl ? (
        <AgentTurn role={ASSESSMENT_CHAT_ROLES.user}>
          <p className="whitespace-pre-wrap wrap-anywhere">{repositoryUrl}</p>
        </AgentTurn>
      ) : null}
    </>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
