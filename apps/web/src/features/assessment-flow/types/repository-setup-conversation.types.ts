import type { ReactNode } from "react";

import type { GitProviderValue } from "./assessment-flow.types";

export type RepositorySetupAnswer = {
  provider: GitProviderValue;
  repositoryUrl: string;
};

export type RepositorySetupConversationProps = {
  provider?: GitProviderValue;
  repositoryUrl?: string;
  providerCapabilities?: Array<{
    provider: string;
    canConnect: boolean;
    canPinSnapshot: boolean;
  }>;
  onProviderChange?: (provider: GitProviderValue) => void;
  disabled?: boolean;
  footer?: ReactNode;
};
