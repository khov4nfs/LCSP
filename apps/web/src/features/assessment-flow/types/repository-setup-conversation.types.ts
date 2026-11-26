import type { ReactNode } from "react";

import type { GitProviderValue } from "./assessment-flow.types";

export type RepositorySetupAnswer = {
  provider: GitProviderValue;
  repositoryUrl: string;
};

export type RepositorySetupConversationProps = {
  provider?: GitProviderValue;
  repositoryUrl?: string;
  onProviderChange?: (provider: GitProviderValue) => void;
  disabled?: boolean;
  providerAvailability?: Partial<Record<GitProviderValue, boolean>>;
  providerTemporarilyUnavailable?: Partial<Record<GitProviderValue, boolean>>;
  footer?: ReactNode;
};
