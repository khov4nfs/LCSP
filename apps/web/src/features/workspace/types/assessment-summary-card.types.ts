import type { LucideIcon } from "lucide-react";

import type { AssessmentSummary } from "./workspace.types";
import type { CanonicalAssessmentRuntimeSnapshot } from "@lcsp/contracts/evidence";
import type { WorkspaceRuntimeConnectionState } from "./workspace-runtime.types";

export type AssessmentSummaryCardProps = {
  assessment: AssessmentSummary;
  statusLabel: string;
  createdAtLabel: string;
  href?: string;
  openAssessmentLabel?: string;
  canonicalAssessment: CanonicalAssessmentRuntimeSnapshot | null;
  connectionState: WorkspaceRuntimeConnectionState;
};

type AssessmentModuleLinkProps = {
  href: string;
  labelKey: Parameters<typeof import("@lcsp/i18n").resolveMessage>[1];
  icon: LucideIcon;
};

export type AssessmentFactProps = {
  label: string;
  value: string;
};
