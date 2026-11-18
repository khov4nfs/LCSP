"use client";

import { CheckCircle2Icon, AlertTriangleIcon, XCircleIcon, ScaleIcon, FileSearchIcon, BookOpenIcon, ArrowRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "@lcsp/contracts/assessment";
import { copy } from "../../utils/conversation-copy";

type StepId = "rule" | "applicability" | "obligation" | "assessment" | "evidence" | "conclusion";

type ComplianceStepFlowProps = {
  activeStep?: StepId;
  onSelectStep?: (step: StepId) => void;
  outcome: string;
};

const STEPS: Array<{ id: StepId; labelKey: string }> = [
  { id: "rule", labelKey: "decision.stepFlow.rule" },
  { id: "applicability", labelKey: "decision.stepFlow.applicability" },
  { id: "obligation", labelKey: "decision.stepFlow.obligation" },
  { id: "assessment", labelKey: "decision.stepFlow.assessment" },
  { id: "evidence", labelKey: "decision.stepFlow.evidence" },
  { id: "conclusion", labelKey: "decision.stepFlow.conclusion" },
];

export function ComplianceStepFlow({
  activeStep = "rule",
  onSelectStep,
  outcome,
}: ComplianceStepFlowProps) {
  const isNonCompliant =
    outcome === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;
  const isCompliant = outcome === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;

  return (
    <nav
      data-slot="compliance-step-flow"
      aria-label={copy("decision.complianceAssessmentTitle")}
      className="flex w-full items-center justify-between gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs"
    >
      {STEPS.map((step, index) => {
        const isActive = activeStep === step.id;
        const isLast = index === STEPS.length - 1;

        let icon = <BookOpenIcon className="size-3.5" aria-hidden="true" />;
        if (step.id === "applicability") {
          icon = <ScaleIcon className="size-3.5" aria-hidden="true" />;
        } else if (step.id === "evidence") {
          icon = <FileSearchIcon className="size-3.5" aria-hidden="true" />;
        } else if (step.id === "assessment" || step.id === "conclusion") {
          if (isCompliant) {
            icon = <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
          } else if (isNonCompliant) {
            icon = <XCircleIcon className="size-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />;
          } else {
            icon = <AlertTriangleIcon className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
          }
        }

        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onSelectStep?.(step.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {icon}
              <span>{copy(step.labelKey)}</span>
            </button>
            {!isLast && (
              <ArrowRightIcon className="size-3 text-muted-foreground/40 shrink-0" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
