"use client";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  WIZARD_DEEP_RESEARCH_STEP_NUMBER,
  wizardSteps,
} from "@/features/wizard/config/wizard-config";
import { t } from "@/features/wizard/lib/wizard-i18n";

type WizardNavigationActionsProps = {
  currentStep: number;
  effectiveIsReadOnly: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onContinueToDetailed: () => void;
  onSaveAndContinue: () => void;
  onSubmit: () => void;
  onOpenSummary: () => void;
  onOpenClassification: () => void;
};

export function WizardNavigationActions({
  currentStep,
  effectiveIsReadOnly,
  isSubmitting,
  onBack,
  onContinueToDetailed,
  onSaveAndContinue,
  onSubmit,
  onOpenSummary,
  onOpenClassification,
}: WizardNavigationActionsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="outline" onClick={onBack}>
        {currentStep <= 0
          ? t("pages.wizard.actions.backToWorkspace")
          : t("pages.wizard.actions.previous")}
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row">
        {effectiveIsReadOnly ? (
          <>
            {currentStep !== -1 ? (
              <Button variant="outline" onClick={onOpenSummary}>
                {t("pages.wizard.summaryTitle")}
              </Button>
            ) : null}
            <Button onClick={onOpenClassification}>
              {t("pages.wizard.actions.openClassification")}
            </Button>
          </>
        ) : currentStep === 0 ? (
          <Button onClick={onContinueToDetailed}>
            {t("pages.wizard.actions.continueToDetailed")}
          </Button>
        ) : currentStep < WIZARD_DEEP_RESEARCH_STEP_NUMBER ? (
          <Button onClick={onSaveAndContinue}>
            {currentStep === wizardSteps.length
              ? t("pages.wizard.actions.continueToDeepResearch")
              : t("pages.wizard.actions.saveAndContinue")}
          </Button>
        ) : (
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            {t("pages.wizard.actions.submit")}
          </Button>
        )}
      </div>
    </div>
  );
}
