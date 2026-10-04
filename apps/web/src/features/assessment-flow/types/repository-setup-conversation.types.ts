import type { ReactNode } from "react";

import type { GitProviderValue } from "./assessment-flow.types";

export const REPOSITORY_ENTRY_INTENTS = {
  initial: "INITIAL",
  add: "ADD",
  edit: "EDIT",
} as const;

export type RepositoryEntryIntent =
  (typeof REPOSITORY_ENTRY_INTENTS)[keyof typeof REPOSITORY_ENTRY_INTENTS];

export type RepositorySetupAnswer = {
  provider: GitProviderValue;
  repositoryUrl: string;
};

export type RepositorySetupConversationProps = {
  provider?: GitProviderValue;
  providerCapabilities?: Array<{
    provider: string;
    canConnect: boolean;
    canPinSnapshot: boolean;
  }>;
  onProviderChange?: (provider: GitProviderValue) => void;
  disabled?: boolean;
  footer?: ReactNode;
};
