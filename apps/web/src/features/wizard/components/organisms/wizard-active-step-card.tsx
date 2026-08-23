"use client";

import { Badge } from "@/components/ui/badge";
import { WizardAgentClarificationCard } from "@/features/wizard/components/molecules/wizard-agent-clarification-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardCheckboxField } from "@/features/wizard/components/molecules/wizard-checkbox-field";
import { WizardFieldWithHelper } from "@/features/wizard/components/molecules/wizard-field-with-helper";
import { WizardSelectField } from "@/features/wizard/components/molecules/wizard-select-field";
import { WizardTextareaField } from "@/features/wizard/components/molecules/wizard-textarea-field";
import {
  checkboxOptions,
  selectOptions,
  WIZARD_DEEP_RESEARCH_STEP_NUMBER,
  wizardDeepResearchStep,
  wizardSteps,
} from "@/features/wizard/config/wizard-config";
import { sectionCardClassName } from "@/features/wizard/lib/wizard-form";
import { t } from "@/features/wizard/lib/wizard-i18n";
import type { WizardActiveStepCardProps } from "@/features/wizard/types/component-props.types";

export function WizardActiveStepCard({
  currentStep,
  effectiveIsReadOnly,
  answers,
  agentClarificationPrompts = [],
  isAskingClarification = false,
  canApproveAgentClarifications = false,
  canAskDeepResearch = false,
  onFieldBlur,
  onFieldChange,
  onHelperOpen,
  onApproveAgentClarifications,
}: WizardActiveStepCardProps) {
  if (currentStep === 0) {
    return (
      <Card className={sectionCardClassName}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Badge variant="outline">{t("pages.wizard.preScreenBadge")}</Badge>
            {effectiveIsReadOnly ? (
              <Badge variant="secondary">
                {t("pages.wizard.readOnlyBadge")}
              </Badge>
            ) : null}
          </div>
          <CardTitle>{t("pages.wizard.preScreenTitle")}</CardTitle>
          <CardDescription>
            {t("pages.wizard.preScreenDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <WizardSelectField
            name="ps_001_ai_scope"
            disabled={effectiveIsReadOnly}
            labelKey="pages.wizard.fields.preAiScopeLabel"
            descriptionKey="pages.wizard.fields.preAiScopeDescription"
            onBlur={onFieldBlur}
            onValueChange={onFieldChange}
            options={selectOptions.yesNoUnknown}
          />
          <WizardCheckboxField
            name="ps_002_affected_people"
            disabled={effectiveIsReadOnly}
            labelKey="pages.wizard.fields.preAffectedPeopleLabel"
            descriptionKey="pages.wizard.fields.preAffectedPeopleDescription"
            options={checkboxOptions.affectedPeople}
            onBlur={onFieldBlur}
            onValueChange={onFieldChange}
          />
          <WizardSelectField
            name="ps_003_personal_or_sensitive_data"
            disabled={effectiveIsReadOnly}
            labelKey="pages.wizard.fields.prePersonalDataLabel"
            descriptionKey="pages.wizard.fields.prePersonalDataDescription"
            onBlur={onFieldBlur}
            onValueChange={onFieldChange}
            options={selectOptions.yesNoUnknown}
          />
          <WizardSelectField
            name="ps_004_decision_importance"
            disabled={effectiveIsReadOnly}
            labelKey="pages.wizard.fields.preDecisionImportanceLabel"
            descriptionKey="pages.wizard.fields.preDecisionImportanceDescription"
            onBlur={onFieldBlur}
            onValueChange={onFieldChange}
            options={selectOptions.yesNoUnknown}
          />
        </CardContent>
      </Card>
    );
  }

  if (currentStep === WIZARD_DEEP_RESEARCH_STEP_NUMBER) {
    return (
      <Card className={sectionCardClassName}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Badge variant="secondary">
              {t("pages.wizard.deepResearch.badge")}
            </Badge>
            {effectiveIsReadOnly ? (
              <Badge variant="secondary">
                {t("pages.wizard.readOnlyBadge")}
              </Badge>
            ) : null}
          </div>
          <CardTitle>{t(wizardDeepResearchStep.titleKey)}</CardTitle>
          <CardDescription>
            {t("pages.wizard.deepResearch.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!canAskDeepResearch ? (
            <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              {t("pages.wizard.deepResearch.lockedDescription")}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("pages.wizard.deepResearch.agentTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("pages.wizard.deepResearch.agentDescription")}
                </p>
              </div>
              {isAskingClarification ? (
                <Badge variant="outline">
                  {t("pages.wizard.clarification.askRunning")}
                </Badge>
              ) : null}
            </div>
          )}
          {canAskDeepResearch ? (
            <WizardAgentClarificationCard
              prompts={agentClarificationPrompts}
              disabled={effectiveIsReadOnly}
              canApprove={canApproveAgentClarifications}
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              onApprove={onApproveAgentClarifications}
            />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={sectionCardClassName}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary">{t("pages.wizard.detailedBadge")}</Badge>
          <div className="flex items-center gap-2">
            {effectiveIsReadOnly ? (
              <Badge variant="secondary">
                {t("pages.wizard.readOnlyBadge")}
              </Badge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {currentStep}/{wizardSteps.length}
            </span>
          </div>
        </div>
        <CardTitle>{t(wizardSteps[currentStep - 1].titleKey)}</CardTitle>
        <CardDescription>{t("pages.wizard.pageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {currentStep === 1 ? (
          <>
            <WizardTextareaField
              name="businessProcess"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.businessProcessLabel"
              descriptionKey="pages.wizard.fields.businessProcessDescription"
              placeholderKey="pages.wizard.fields.businessProcessPlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardTextareaField
              name="useCase"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.useCaseLabel"
              descriptionKey="pages.wizard.fields.useCaseDescription"
              placeholderKey="pages.wizard.fields.useCasePlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardTextareaField
              name="primaryActors"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.primaryActorsLabel"
              descriptionKey="pages.wizard.fields.primaryActorsDescription"
              placeholderKey="pages.wizard.fields.primaryActorsPlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardTextareaField
              name="businessTrigger"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.businessTriggerLabel"
              descriptionKey="pages.wizard.fields.businessTriggerDescription"
              placeholderKey="pages.wizard.fields.businessTriggerPlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardTextareaField
              name="expectedOutcome"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.expectedOutcomeLabel"
              descriptionKey="pages.wizard.fields.expectedOutcomeDescription"
              placeholderKey="pages.wizard.fields.expectedOutcomePlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardTextareaField
              name="aiPurpose"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.aiPurposeLabel"
              descriptionKey="pages.wizard.fields.aiPurposeDescription"
              placeholderKey="pages.wizard.fields.aiPurposePlaceholder"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardSelectField
              name="autonomyLevel"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.autonomyLevelLabel"
              descriptionKey="pages.wizard.fields.autonomyLevelDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={selectOptions.autonomyLevel}
            />
            <WizardSelectField
              name="sector"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.sectorLabel"
              descriptionKey="pages.wizard.fields.sectorDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={selectOptions.sector}
            />
          </>
        ) : null}

        {currentStep === 2 ? (
          <>
            <WizardCheckboxField
              name="dataTypes"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.dataTypeLabel"
              descriptionKey="pages.wizard.fields.dataTypeDescription"
              options={checkboxOptions.dataType}
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
            />
            <WizardCheckboxField
              name="affectedSubjects"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.affectedSubjectsLabel"
              descriptionKey="pages.wizard.fields.affectedSubjectsDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={checkboxOptions.affectedPeople}
            />
            <WizardSelectField
              name="userImpact"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.userImpactLabel"
              descriptionKey="pages.wizard.fields.userImpactDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={selectOptions.userImpact}
            />
          </>
        ) : null}

        {currentStep === 3 ? (
          <>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("decision")}
            >
              <WizardSelectField
                name="decisionRole"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.decisionRoleLabel"
                descriptionKey="pages.wizard.fields.decisionRoleDescription"
                extraDescriptionKey="pages.wizard.fields.decisionRoleExamples"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={selectOptions.decisionRole}
              />
            </WizardFieldWithHelper>
            {answers.decisionRole !== "NO_DECISION_SUPPORT" ? (
              <WizardFieldWithHelper
                onHelperClick={() => onHelperOpen("oversight")}
              >
                <WizardSelectField
                  name="humanReview"
                  disabled={effectiveIsReadOnly}
                  labelKey="pages.wizard.fields.humanReviewLabel"
                  descriptionKey="pages.wizard.fields.humanReviewDescription"
                  onBlur={onFieldBlur}
                  onValueChange={onFieldChange}
                  options={selectOptions.humanOversight}
                />
              </WizardFieldWithHelper>
            ) : null}
          </>
        ) : null}

        {currentStep === 4 ? (
          <WizardFieldWithHelper onHelperClick={() => onHelperOpen("provider")}>
            <WizardSelectField
              name="externalLlmUsage"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.externalLlmUsageLabel"
              descriptionKey="pages.wizard.fields.externalLlmUsageDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={selectOptions.externalProvider}
            />
          </WizardFieldWithHelper>
        ) : null}

        {currentStep === 5 ? (
          <WizardFieldWithHelper
            onHelperClick={() => onHelperOpen("deployment")}
          >
            <WizardCheckboxField
              name="deploymentContext"
              disabled={effectiveIsReadOnly}
              labelKey="pages.wizard.fields.deploymentContextLabel"
              descriptionKey="pages.wizard.fields.deploymentContextDescription"
              onBlur={onFieldBlur}
              onValueChange={onFieldChange}
              options={checkboxOptions.deploymentContext}
            />
          </WizardFieldWithHelper>
        ) : null}

        {currentStep === 6 ? (
          <>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("specialCategory")}
            >
              <WizardSelectField
                name="specialCategoryData"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.specialCategoryDataLabel"
                descriptionKey="pages.wizard.fields.specialCategoryDataDescription"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={selectOptions.yesNoUnknown}
              />
            </WizardFieldWithHelper>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("biometric")}
            >
              <WizardSelectField
                name="biometricData"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.biometricIndicatorLabel"
                descriptionKey="pages.wizard.fields.biometricIndicatorDescription"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={selectOptions.yesNoUnknown}
              />
            </WizardFieldWithHelper>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("highImpact")}
            >
              <WizardCheckboxField
                name="highImpactIndicators"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.highImpactIndicatorLabel"
                descriptionKey="pages.wizard.fields.highImpactIndicatorDescription"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={checkboxOptions.highImpactIndicators}
              />
            </WizardFieldWithHelper>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("transparency")}
            >
              <WizardCheckboxField
                name="transparencyIndicators"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.transparencyIndicatorsLabel"
                descriptionKey="pages.wizard.fields.transparencyIndicatorsDescription"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={checkboxOptions.transparencyIndicators}
              />
            </WizardFieldWithHelper>
            <WizardFieldWithHelper
              onHelperClick={() => onHelperOpen("prohibited")}
            >
              <WizardCheckboxField
                name="prohibitedRiskSignals"
                disabled={effectiveIsReadOnly}
                labelKey="pages.wizard.fields.prohibitedRiskSignalsLabel"
                descriptionKey="pages.wizard.fields.prohibitedRiskSignalsDescription"
                onBlur={onFieldBlur}
                onValueChange={onFieldChange}
                options={checkboxOptions.prohibitedRiskSignals}
              />
            </WizardFieldWithHelper>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
