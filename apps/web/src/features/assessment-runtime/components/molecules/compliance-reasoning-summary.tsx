"use client";

import {
  CheckCircle2Icon,
  XCircleIcon,
  AlertTriangleIcon,
  ScaleIcon,
  CodeIcon,
  FileCheck2Icon,
  MessageSquareShareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RULE_DECISION_COMPLIANCE_OUTCOMES } from "@lcsp/contracts/assessment";
import type { LegalRuleSynthesis } from "../../types/legal-rule-output.types";
import { copy } from "../../utils/conversation-copy";

type ComplianceReasoningSummaryProps = {
  synthesis: LegalRuleSynthesis;
  outcome: string;
  onAskAboutRule?: () => void;
};

export function ComplianceReasoningSummary({
  synthesis,
  outcome,
  onAskAboutRule,
}: ComplianceReasoningSummaryProps) {
  const isCompliant = outcome === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;
  const isNonCompliant =
    outcome === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;

  const steps = [
    {
      num: 1,
      title: copy("decision.synthesis.step1Title"),
      content: synthesis.step1Obligation,
      icon: <ScaleIcon className="size-4 text-indigo-500" aria-hidden="true" />,
    },
    {
      num: 2,
      title: copy("decision.synthesis.step2Title"),
      content: synthesis.step2Scope,
      icon: <CodeIcon className="size-4 text-sky-500" aria-hidden="true" />,
    },
    {
      num: 3,
      title: copy("decision.synthesis.step3Title"),
      content: synthesis.step3Evidence,
      icon: <FileCheck2Icon className="size-4 text-purple-500" aria-hidden="true" />,
    },
    {
      num: 4,
      title: copy("decision.synthesis.step4Title"),
      content: synthesis.step4Fulfillment,
      icon: isCompliant ? (
        <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden="true" />
      ) : isNonCompliant ? (
        <XCircleIcon className="size-4 text-rose-600" aria-hidden="true" />
      ) : (
        <AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />
      ),
    },
    {
      num: 5,
      title: copy("decision.synthesis.step5Title"),
      content: synthesis.step5Conclusion,
      icon: isCompliant ? (
        <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden="true" />
      ) : isNonCompliant ? (
        <XCircleIcon className="size-4 text-rose-600" aria-hidden="true" />
      ) : (
        <AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />
      ),
      isConclusion: true,
    },
  ];

  return (
    <div data-slot="compliance-reasoning-summary" className="flex flex-col gap-4">
      {/* 5-Step Timeline Cards */}
      <ol className="relative flex flex-col gap-3 pl-2 sm:pl-3 border-l-2 border-border/80 ml-2">
        {steps.map((step) => (
          <li
            key={step.num}
            className={cn(
              "relative flex flex-col gap-1.5 rounded-lg border p-3.5 transition-colors",
              step.isConclusion
                ? isCompliant
                  ? "border-emerald-500/40 bg-emerald-50/30 dark:border-emerald-500/20 dark:bg-emerald-950/20"
                  : isNonCompliant
                    ? "border-rose-500/40 bg-rose-50/30 dark:border-rose-500/20 dark:bg-rose-950/20"
                    : "border-amber-500/40 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-950/20"
                : "border-border/70 bg-card hover:border-primary/40",
            )}
          >
            {/* Step marker node */}
            <span
              className={cn(
                "absolute -left-5 sm:-left-6 top-4 flex size-6 items-center justify-center rounded-full border bg-background text-xs font-bold shadow-2xs",
                step.isConclusion
                  ? isCompliant
                    ? "border-emerald-500 text-emerald-600"
                    : isNonCompliant
                      ? "border-rose-500 text-rose-600"
                      : "border-amber-500 text-amber-600"
                  : "border-border text-muted-foreground",
              )}
            >
              {step.num}
            </span>

            <header className="flex items-center gap-2 font-medium text-xs text-foreground">
              {step.icon}
              <h5 className="font-semibold">{step.title}</h5>
            </header>

            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {step.content}
            </p>
          </li>
        ))}
      </ol>

      {/* Follow-up question action */}
      {onAskAboutRule && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="ask-follow-up-rule"
            onClick={onAskAboutRule}
            className="h-8 gap-1.5 text-xs font-medium text-primary hover:text-primary/90"
          >
            <MessageSquareShareIcon className="size-3.5" aria-hidden="true" />
            <span>{copy("decision.askAboutRule")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
