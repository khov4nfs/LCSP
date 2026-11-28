import type { ReactNode } from "react";

import type { GitProviderValue } from "./assessment-flow.types";

export type RepositorySetupConversationProps = {
  provider?: GitProviderValue;
  onProviderChange?: (provider: GitProviderValue) => void;
  disabled?: boolean;
  providerAvailability?: Partial<Record<GitProviderValue, boolean>>;
  providerTemporarilyUnavailable?: Partial<Record<GitProviderValue, boolean>>;
  footer?: ReactNode;
};
