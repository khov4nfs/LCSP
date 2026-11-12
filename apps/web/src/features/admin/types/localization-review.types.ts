import type { AuthoredLocalizationQueueItem } from "@lcsp/contracts/assessment-domain";

export type LocalizationScopeReviewProps = {
  scopeId: string;
};

export type LocalizationQueueItemFieldProps = {
  item: AuthoredLocalizationQueueItem;
  index: number;
  disabled?: boolean;
  onReviewSource: (index: number) => void;
  onApproveOutput: (index: number) => void;
  onRejectCandidate: (index: number) => void;
  onRetryRequest: (index: number) => void;
};
