import type { LucideIcon } from "lucide-react";

import type { AssessmentSummary } from "./workspace.types";

export type AssessmentSummaryCardProps = {
  assessment: AssessmentSummary;
  statusLabel: string;
  createdAtLabel: string;
  href?: string;
  openAssessmentLabel?: string;
};

export type AssessmentModuleLinkProps = {
  href: string;
  labelKey: Parameters<typeof import("@lcsp/i18n").resolveMessage>[1];
  icon: LucideIcon;
};

export type AssessmentFactProps = {
  label: string;
  value: string;
};
