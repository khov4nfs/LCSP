export const WIZARD_FIELD_CONTROLS = {
  textarea: "textarea",
  select: "select",
  checkbox: "checkbox",
} as const;

export type WizardFieldControl =
  (typeof WIZARD_FIELD_CONTROLS)[keyof typeof WIZARD_FIELD_CONTROLS];

export const WIZARD_CHECKBOX_OPTIONS = {
  affectedPeople: [
    "pages.wizard.options.userGroupCustomers",
    "pages.wizard.options.userGroupEmployees",
    "pages.wizard.options.userGroupApplicants",
    "pages.wizard.options.userGroupStudents",
    "pages.wizard.options.userGroupPatients",
  ],
  dataType: [
    "pages.wizard.options.dataTypePersonal",
    "pages.wizard.options.dataTypeSensitive",
    "pages.wizard.options.dataTypeBiometric",
    "pages.wizard.options.dataTypeBehavioral",
    "pages.wizard.options.dataTypeOperational",
  ],
  deploymentContext: [
    "pages.wizard.options.deploymentInternal",
    "pages.wizard.options.deploymentExternal",
  ],
  highImpactIndicators: [
    "pages.wizard.options.highImpactRecruiting",
    "pages.wizard.options.highImpactCredit",
    "pages.wizard.options.highImpactEducation",
    "pages.wizard.options.highImpactHealthcare",
    "pages.wizard.options.no",
    "pages.wizard.options.unknown",
  ],
  transparencyIndicators: [
    "pages.wizard.options.transparencyDirectInteraction",
    "pages.wizard.options.transparencyContentGeneration",
  ],
  prohibitedRiskSignals: [
    "pages.wizard.options.prohibitedTracking",
    "pages.wizard.options.prohibitedManipulation",
    "pages.wizard.options.prohibitedScoring",
    "pages.wizard.options.prohibitedSensitiveInference",
    "pages.wizard.options.no",
    "pages.wizard.options.unknown",
  ],
} as const;

export const WIZARD_SELECT_OPTIONS = {
  yesNoUnknown: [
    { value: "yes", labelKey: "pages.wizard.options.yes" },
    { value: "no", labelKey: "pages.wizard.options.no" },
    { value: "unknown", labelKey: "pages.wizard.options.unknown" },
  ],
  sector: [
    {
      value: "GENERAL_BUSINESS",
      labelKey: "pages.wizard.options.sectorGeneral",
    },
    { value: "EMPLOYMENT_HR", labelKey: "pages.wizard.options.sectorHr" },
    {
      value: "FINANCE_CREDIT",
      labelKey: "pages.wizard.options.sectorFinance",
    },
    {
      value: "EDUCATION",
      labelKey: "pages.wizard.options.sectorEducation",
    },
    {
      value: "HEALTHCARE",
      labelKey: "pages.wizard.options.sectorHealthcare",
    },
    {
      value: "PUBLIC_SERVICES",
      labelKey: "pages.wizard.options.sectorPublicServices",
    },
    {
      value: "GOVERNANCE_RISK_COMPLIANCE",
      labelKey: "pages.wizard.options.sectorGovernanceRiskCompliance",
    },
  ],
  userGroup: [
    {
      value: "CUSTOMERS",
      labelKey: "pages.wizard.options.userGroupCustomers",
    },
    {
      value: "EMPLOYEES",
      labelKey: "pages.wizard.options.userGroupEmployees",
    },
    {
      value: "APPLICANTS",
      labelKey: "pages.wizard.options.userGroupApplicants",
    },
    {
      value: "STUDENTS",
      labelKey: "pages.wizard.options.userGroupStudents",
    },
    {
      value: "PATIENTS",
      labelKey: "pages.wizard.options.userGroupPatients",
    },
  ],
  userImpact: [
    { value: "LOW", labelKey: "pages.wizard.options.userImpactLow" },
    {
      value: "MODERATE",
      labelKey: "pages.wizard.options.userImpactModerate",
    },
    {
      value: "SIGNIFICANT",
      labelKey: "pages.wizard.options.userImpactSignificant",
    },
    { value: "UNKNOWN", labelKey: "pages.wizard.options.unknown" },
  ],
  decisionRole: [
    {
      value: "NO_DECISION_SUPPORT",
      labelKey: "pages.wizard.options.decisionRoleNoAutonomousDecision",
    },
    {
      value: "ASSISTS_DECISION",
      labelKey: "pages.wizard.options.decisionRoleSupportsDecision",
    },
    {
      value: "INFORMS_DECISION",
      labelKey: "pages.wizard.options.decisionRoleInformsDecision",
    },
    {
      value: "RECOMMENDS_OUTCOME",
      labelKey: "pages.wizard.options.decisionRoleRecommendsOutcome",
    },
    {
      value: "DIRECTLY_DRIVES_OUTCOME",
      labelKey: "pages.wizard.options.decisionRoleDirectlyDrivesOutcome",
    },
  ],
  humanOversight: [
    {
      value: "PRESENT",
      labelKey: "pages.wizard.options.humanOversightPresent",
    },
    {
      value: "LIMITED",
      labelKey: "pages.wizard.options.humanOversightLimited",
    },
    {
      value: "ABSENT",
      labelKey: "pages.wizard.options.humanOversightAbsent",
    },
    { value: "UNCLEAR", labelKey: "pages.wizard.options.unknown" },
    {
      value: "NOT_APPLICABLE",
      labelKey: "pages.wizard.options.humanOversightNotApplicable",
    },
  ],
  externalProvider: [
    { value: "NONE", labelKey: "pages.wizard.options.externalNone" },
    {
      value: "POSSIBLE",
      labelKey: "pages.wizard.options.externalPossible",
    },
    {
      value: "CONFIRMED",
      labelKey: "pages.wizard.options.externalConfirmed",
    },
    { value: "UNKNOWN", labelKey: "pages.wizard.options.unknown" },
  ],
  autonomyLevel: [
    {
      value: "HUMAN_ASSISTED",
      labelKey: "pages.wizard.options.autonomyHumanAssisted",
    },
    {
      value: "HUMAN_APPROVAL_REQUIRED",
      labelKey: "pages.wizard.options.autonomyHumanApprovalRequired",
    },
    {
      value: "CONDITIONAL_AUTOMATION",
      labelKey: "pages.wizard.options.autonomyConditionalAutomation",
    },
    {
      value: "FULL_AUTOMATION",
      labelKey: "pages.wizard.options.autonomyFullAutomation",
    },
    { value: "UNKNOWN", labelKey: "pages.wizard.options.unknown" },
  ],
} as const;

export const WIZARD_STEPS = [
  {
    id: "purpose",
    titleKey: "pages.wizard.sections.purpose",
    fields: [
      "businessProcess",
      "useCase",
      "primaryActors",
      "businessTrigger",
      "expectedOutcome",
      "aiPurpose",
      "autonomyLevel",
      "sector",
    ],
  },
  {
    id: "data-users",
    titleKey: "pages.wizard.sections.dataUsers",
    fields: ["dataTypes", "affectedSubjects", "userImpact"],
  },
  {
    id: "decision",
    titleKey: "pages.wizard.sections.decision",
    fields: ["decisionRole", "humanReview"],
  },
  {
    id: "provider",
    titleKey: "pages.wizard.sections.provider",
    fields: ["externalLlmUsage"],
  },
  {
    id: "deployment",
    titleKey: "pages.wizard.sections.deployment",
    fields: ["deploymentContext"],
  },
  {
    id: "risk",
    titleKey: "pages.wizard.sections.risk",
    fields: [
      "specialCategoryData",
      "biometricData",
      "highImpactIndicators",
      "transparencyIndicators",
      "prohibitedRiskSignals",
    ],
  },
] as const;

export type WizardExportFieldDefinition = {
  questionId: string;
  labelKey: string;
  control: WizardFieldControl;
  optionSet?: string;
};

export type WizardExportSectionDefinition = {
  id: string;
  titleKey: string;
  fields: readonly WizardExportFieldDefinition[];
};

export const WIZARD_EXPORT_SECTIONS = [
  {
    id: "pre-screen",
    titleKey: "pages.wizard.preScreenTitle",
    fields: [
      {
        questionId: "ps_001_ai_scope",
        labelKey: "pages.wizard.fields.preAiScopeLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "yesNoUnknown",
      },
      {
        questionId: "ps_002_affected_people",
        labelKey: "pages.wizard.fields.preAffectedPeopleLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "affectedPeople",
      },
      {
        questionId: "ps_003_personal_or_sensitive_data",
        labelKey: "pages.wizard.fields.prePersonalDataLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "yesNoUnknown",
      },
      {
        questionId: "ps_004_decision_importance",
        labelKey: "pages.wizard.fields.preDecisionImportanceLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "yesNoUnknown",
      },
    ],
  },
  {
    id: "purpose",
    titleKey: "pages.wizard.sections.purpose",
    fields: [
      {
        questionId: "businessProcess",
        labelKey: "pages.wizard.fields.businessProcessLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "useCase",
        labelKey: "pages.wizard.fields.useCaseLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "primaryActors",
        labelKey: "pages.wizard.fields.primaryActorsLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "businessTrigger",
        labelKey: "pages.wizard.fields.businessTriggerLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "expectedOutcome",
        labelKey: "pages.wizard.fields.expectedOutcomeLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "aiPurpose",
        labelKey: "pages.wizard.fields.aiPurposeLabel",
        control: WIZARD_FIELD_CONTROLS.textarea,
      },
      {
        questionId: "autonomyLevel",
        labelKey: "pages.wizard.fields.autonomyLevelLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "autonomyLevel",
      },
      {
        questionId: "sector",
        labelKey: "pages.wizard.fields.sectorLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "sector",
      },
    ],
  },
  {
    id: "data-users",
    titleKey: "pages.wizard.sections.dataUsers",
    fields: [
      {
        questionId: "dataTypes",
        labelKey: "pages.wizard.fields.dataTypeLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "dataType",
      },
      {
        questionId: "affectedSubjects",
        labelKey: "pages.wizard.fields.affectedSubjectsLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "affectedPeople",
      },
      {
        questionId: "userImpact",
        labelKey: "pages.wizard.fields.userImpactLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "userImpact",
      },
    ],
  },
  {
    id: "decision",
    titleKey: "pages.wizard.sections.decision",
    fields: [
      {
        questionId: "decisionRole",
        labelKey: "pages.wizard.fields.decisionRoleLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "decisionRole",
      },
      {
        questionId: "humanReview",
        labelKey: "pages.wizard.fields.humanReviewLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "humanOversight",
      },
    ],
  },
  {
    id: "provider",
    titleKey: "pages.wizard.sections.provider",
    fields: [
      {
        questionId: "externalLlmUsage",
        labelKey: "pages.wizard.fields.externalLlmUsageLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "externalProvider",
      },
    ],
  },
  {
    id: "deployment",
    titleKey: "pages.wizard.sections.deployment",
    fields: [
      {
        questionId: "deploymentContext",
        labelKey: "pages.wizard.fields.deploymentContextLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "deploymentContext",
      },
    ],
  },
  {
    id: "risk",
    titleKey: "pages.wizard.sections.risk",
    fields: [
      {
        questionId: "specialCategoryData",
        labelKey: "pages.wizard.fields.specialCategoryDataLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "yesNoUnknown",
      },
      {
        questionId: "biometricData",
        labelKey: "pages.wizard.fields.biometricIndicatorLabel",
        control: WIZARD_FIELD_CONTROLS.select,
        optionSet: "yesNoUnknown",
      },
      {
        questionId: "highImpactIndicators",
        labelKey: "pages.wizard.fields.highImpactIndicatorLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "highImpactIndicators",
      },
      {
        questionId: "transparencyIndicators",
        labelKey: "pages.wizard.fields.transparencyIndicatorsLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "transparencyIndicators",
      },
      {
        questionId: "prohibitedRiskSignals",
        labelKey: "pages.wizard.fields.prohibitedRiskSignalsLabel",
        control: WIZARD_FIELD_CONTROLS.checkbox,
        optionSet: "prohibitedRiskSignals",
      },
    ],
  },
] as const satisfies readonly WizardExportSectionDefinition[];

export const WIZARD_EXPORT_QUESTION_IDS = WIZARD_EXPORT_SECTIONS.flatMap(
  (section) => section.fields.map((field) => field.questionId),
);
