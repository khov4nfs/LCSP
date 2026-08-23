import type { PagesMessages } from "../../types.ts";
export const enPages = {
  appShell: {
    productName: "LCSP",
    productTagline: "Compliance operations",
    mobileTitle: "LCSP workspace",
    mobileDescription: "Navigate assessments and compliance workflows.",
    sidebarToggle: "Toggle workspace navigation",
    headerEyebrow: "Compliance workspace",
    workspaceTitle: "Workspace overview",
    assessmentTitle: "Assessment workflow",
    developerTitle: "Developer tasks",
    workspaceNavigation: "Workspace",
    assessmentNavigation: "Current assessment",
    chooseAssessmentToView: "Choose an assessment to view",
    selectAssessmentFirst: "Please select your assessment first.",
    developerNavigation: "Developer",
    overview: "Overview",
    assessments: "Assessments",
    recentAssessments: "Recent assessments",
    moreAssessments: "More assessments",
    allAssessments: "All assessments",
    searchAssessments: "Search assessments",
    noAssessmentMatches: "No matching assessments found.",
    settings: "Settings",
    wizard: "Intake wizard",
    readiness: "Readiness",
    technicalEvidence: "Technical evidence",
    classification: "Classification",
    documents: "Documents",
    conflicts: "Conflict review",
    developer: "Technical findings",
    developers: "Developers",
    legalLibrary: "Laws",
    secureWorkspace: "Protected organization workspace",
    signOut: "Sign out",
    switchWorkspace: "Switch workspace",
    currentWorkspace: "Current workspace",
    switchingWorkspace: "Switching workspace",
    workspaceMenuTitle: "Switch workspace",
    authEyebrow: "Governance, without the guesswork",
    authTitle: "Move every AI assessment forward with evidence.",
    authDescription:
      "LCSP keeps intake, readiness, classification, and review in one controlled workspace.",
    runtimePanelTitle: "Runtime activity",
    runtimePanelAwaiting: "Waiting for runtime activity",
    runtimePanelLastUpdated: "Last updated",
    runtimePanelActiveTools: "Active tools",
    runtimePanelRecentActivity: "Recent activity",
    runtimePanelEmpty: "No runtime activity for this assessment yet.",
    runtimePanelViewFull: "View full runtime",
    runtimePanelStatuses: {
      running: "Running",
      waiting: "Waiting",
      completed: "Completed",
      failed: "Failed",
    },
    runtimePanelStages: {
      snapshot: "Snapshot",
      scan: "Scan",
      technicalEvidence: "Technical evidence",
      technicalProfile: "Technical profile",
      aiUsageFlow: "AI usage flow",
      reconciliation: "Reconciliation",
      classification: "Classification",
      conflicts: "Conflicts",
      documents: "Documents",
      legalRetrieval: "Legal retrieval",
    },
    runtimePanelConnection: {
      connected: "Connected",
      connecting: "Connecting",
      disconnected: "Disconnected",
    },
    runtimePanelEvents: {
      runStarted: "Run started",
      runStageChanged: "Stage changed",
      toolStarted: "Tool started",
      toolCompleted: "Tool completed",
      toolFailed: "Tool failed",
      toolWaitingInput: "Waiting for input",
      toolSkipped: "Tool skipped",
      runCompleted: "Run completed",
      runFailed: "Run failed",
    },
  },
  signIn: {
    metadataTitle: "Sign in | LCSP",
    metadataDescription: "Access the LCSP compliance workspace.",
    homeAriaLabel: "LCSP home",
    formEyebrow: "Secure access",
    formTitle: "Sign in to LCSP",
    formDescription: "Use your approved organization account.",
    emailLabel: "Work email",
    emailDescription: "Enter the address associated with your organization.",
    passwordLabel: "Password",
    passwordDescription:
      "On a shared device, do not save this password in your browser.",
    submit: "Sign in",
    submitting: "Checking access",
    divider: "Others",
    oauthGoogle: "Google",
    oauthGitHub: "GitHub",
    accessHelp: "Need access? Contact your organization owner.",
    forgotPassword: "Forgot password?",
    errors: {
      emailRequired: "Enter your work email.",
      emailInvalid: "Enter a valid work email.",
      passwordRequired: "Enter your password.",
      requestFailedTitle: "Unable to sign in",
      requestFailedDetail: "Unable to sign in. Please try again.",
      retryAtLabel: "You can try again at",
    },
  },
  mfaVerify: {
    metadataTitle: "Verify your identity | LCSP",
    metadataDescription: "Complete multi-factor verification to continue.",
    homeAriaLabel: "LCSP home",
    formEyebrow: "Secure verification",
    formTitle: "Enter your verification code",
    formDescription: "Use the six-digit code from your authenticator app.",
    otpLabel: "Verification code",
    otpDescription: "Enter the current six-digit code.",
    moreOptions: "More options",
    useAuthenticator: "Use authenticator app",
    recoveryCodeTitle: "Enter a recovery code",
    recoveryCodeDescription:
      "Use one unused recovery code from your saved MFA recovery set.",
    recoveryCodeLabel: "Recovery code",
    recoveryCodePlaceholder: "ABCD-EFGH-IJKL",
    recoveryCodeHelp: "Each recovery code can be used once.",
    recoveryCodeSubmit: "Verify recovery code",
    submit: "Verify code",
    submitting: "Verifying code",
    accessHelp: "Need help? Contact your organization owner.",
    useRecovery: "Lost access to your authenticator? Recover access instead.",
    errors: {
      otpRequired: "Enter your verification code.",
      otpInvalidFormat: "Enter a six-digit verification code.",
      recoveryCodeRequired: "Enter a recovery code.",
      recoveryCodeInvalidFormat: "Enter a valid recovery code.",
      requestFailedTitle: "Unable to verify",
      requestFailedDetail: "Unable to verify the code. Please try again.",
    },
  },
  mfaEnroll: {
    metadataTitle: "Set up MFA | LCSP",
    metadataDescription:
      "Set up your authenticator app before entering the workspace.",
    homeAriaLabel: "LCSP home",
    formEyebrow: "Security setup",
    formTitle: "Enable multi-factor authentication",
    formDescription:
      "Generate your authenticator app configuration, then continue to code verification.",
    submit: "Generate MFA setup",
    submitting: "Generating MFA setup",
    goToVerify: "I already have a code",
    accessHelp:
      "This does not change your access process. It completes the required protection step.",
    successTitle: "MFA setup generated",
    successDetail:
      "Open this URI in your authenticator app, then continue to code verification.",
    copyCodes: "Copy",
    downloadCodes: "Download",
    printCodes: "Print",
    openAuthenticator: "Open in authenticator",
    qrTitle: "Scan this QR code in your authenticator app",
    qrHint:
      "If opening the authenticator app is unavailable on this device, scan this QR code from your phone instead.",
    qrAlt: "QR code for the LCSP MFA authenticator setup",
    qrLoading: "Preparing a QR code for your authenticator app.",
    errors: {
      requestFailedTitle: "Unable to set up MFA",
      requestFailedDetail: "The MFA setup could not be generated right now.",
    },
  },
  recoveryRequest: {
    metadataTitle: "Recover password | LCSP",
    metadataDescription: "Request a safe password recovery link.",
    homeAriaLabel: "LCSP home",
    formEyebrow: "Recover access",
    formTitle: "Request password recovery",
    formDescription: "Enter your work email to start the safe recovery flow.",
    emailLabel: "Work email",
    emailDescription: "Use the email linked to your LCSP account.",
    submit: "Send recovery request",
    submitting: "Sending recovery request",
    backToSignIn: "Back to sign in",
    successTitle: "Request received",
    successDetail:
      "If the email exists in the system, recovery instructions will be sent through the appropriate channel.",
    errors: {
      emailRequired: "Enter your work email.",
      emailInvalid: "Enter a valid work email.",
      requestFailedTitle: "Unable to send request",
      requestFailedDetail: "The recovery request could not be sent right now.",
    },
  },
  recoveryConfirm: {
    metadataTitle: "Reset password | LCSP",
    metadataDescription:
      "Confirm your recovery request and set a new password.",
    homeAriaLabel: "LCSP home",
    formEyebrow: "Complete recovery",
    formTitle: "Set a new password",
    formDescription:
      "Use a valid recovery token to reset your password and revoke older sessions.",
    tokenLabel: "Recovery token",
    tokenDescription: "Paste the token or recovery link value you received.",
    passwordLabel: "New password",
    passwordDescription: "Use at least 12 characters.",
    submit: "Confirm recovery",
    submitting: "Updating password",
    requestAnother: "Request another recovery link",
    errors: {
      tokenRequired: "Enter the recovery token.",
      passwordTooShort: "Password must be at least 12 characters.",
      requestFailedTitle: "Unable to recover password",
      requestFailedDetail:
        "Password recovery could not be completed right now.",
    },
  },
  acceptInvitation: {
    metadataTitle: "Accept developer invitation | LCSP",
    metadataDescription: "Review and accept your scoped developer invitation.",
    eyebrow: "Developer access",
    title: "Accept your invitation",
    description:
      "Review the access being granted before creating your account.",
    loading: "Loading invitation details",
    organizationScope: "Organization-scoped access",
    expiresLabel: "Invitation expires",
    displayNameLabel: "Display name",
    displayNameDescription:
      "Enter the name teammates should see (1–100 characters).",
    passwordLabel: "Password",
    passwordDescription: "Use at least 12 characters.",
    submit: "Accept invitation",
    submitting: "Creating your account",
    signInInstead: "Sign in instead.",
    errors: {
      displayNameRequired: "Enter your display name.",
      displayNameTooLong: "Display name must be 100 characters or fewer.",
      passwordTooShort: "Password must be at least 12 characters.",
      invalidTitle: "Invitation unavailable",
      invalidDetail:
        "This invitation link is no longer valid. Ask your organization owner for a new one.",
      emailExistsTitle: "Account already exists",
      emailExistsDetail: "An account already exists for this email.",
      requestTitle: "Unable to accept invitation",
      requestDetail: "The invitation could not be accepted. Please try again.",
    },
  },
  developerTask: {
    metadataTitle: "Developer task workspace | LCSP",
    metadataDescription: "Review assigned redacted technical findings.",
    sidebarTitle: "Developer workspace",
    sidebarDescription: "Developer task navigation",
    sidebarToggle: "Toggle developer task navigation",
    navigationLabel: "Developer task",
    taskNav: "Technical findings",
    pageTitle: "Scoped task workspace",
    pageDescription: "Review the redacted technical findings assigned to you.",
    selectionTitle: "Choose an assessment",
    selectionDescription:
      "Open an assessment within your current organization scope.",
    openAssessment: "Open technical findings",
    loading: "Loading your task",
    scopeTitle: "Your access scope",
    scopeDescription: "This scope is controlled by your organization owner.",
    organization: "Organization",
    assessment: "Assessment",
    organizationScope: "Organization scope",
    grantedActions: "Granted actions",
    hiddenBoundaryTitle: "Protected information remains hidden",
    hiddenBoundary:
      "You cannot see: source code, file paths, line numbers, or Manager-only actions.",
    findingsTitle: "Redacted technical findings",
    findingsDescription:
      "Only the finding details permitted by your current scope are shown.",
    emptyTitle: "No technical findings available yet for this assessment.",
    emptyDescription: "Check back after technical evidence has been processed.",
    revokedTitle: "Access revoked",
    revokedDetail: "Your access to this task was revoked.",
    errorTitle: "Task unavailable",
    errorDetail: "This task cannot be loaded right now. Please try again.",
    actions: {
      assessmentList: "Browse assigned assessments",
      evidenceReadRedacted: "View redacted technical findings",
      aiUsageFlowRead: "View AI usage flow",
      findingsReadRedacted: "Review redacted findings",
      conflictComment: "Comment on conflicts",
      scanRead: "View scan status",
    },
  },
  workspace: {
    metadataTitle: "Workspace | LCSP",
    metadataDescription: "Manage the active LCSP organization workspace.",
    productName: "LCSP",
    sidebarTitle: "Workspace",
    sidebarDescription: "Workspace navigation",
    sidebarToggle: "Toggle workspace navigation",
    pageTitle: "Workspace dashboard",
    pageDescription:
      "Review organization context, granted workspace actions, and active assessments.",
    organizationLabel: "Organization",
    membershipRoleLabel: "Membership role",
    navigationLabel: "Workspace navigation",
    overviewNav: "Overview",
    assessmentsNav: "Assessments",
    documentsNav: "Documents",
    createAssessment: "Create Assessment",
    newAssessmentName: "New assessment",
    openConflictResolution: "Open conflict resolution",
    openWizard: "Open Wizard",
    assessmentsTitle: "Assessments",
    assessmentsDescription:
      "Track assessment progress from wizard intake through review.",
    overviewAssessmentsTitle: "Manage assessments",
    overviewAssessmentsDescription:
      "Open the full list to track progress and continue each assessment.",
    openAssessments: "Open assessment list",
    insightsTitle: "Assessment overview",
    totalAssessments: "Total assessments",
    needsAttention: "Needs follow-up",
    readyForReview: "Ready for review",
    recentAssessmentsTitle: "Recent assessments",
    recentAssessmentsDescription:
      "Quickly open recently created assessments or view the full list.",
    settingsTitle: "Account settings",
    settingsDescription:
      "Manage MFA, recovery access, and account protection outside the dashboard overview.",
    emptyTitle: "No assessments yet",
    emptyDescription: "Create your first assessment.",
    loadingAssessments: "Loading assessments",
    statusLabel: "Status",
    wizardStatusLabel: "Wizard status",
    createdAtLabel: "Created",
    progressLabel: "Assessment progress",
    statuses: {
      WIZARD_IN_PROGRESS: "In Progress",
      WIZARD_SUBMITTED: "Wizard Complete",
      EVIDENCE_REQUIRED: "Evidence Needed",
      SCAN_IN_PROGRESS: "Scan Running",
      CLASSIFICATION_LOCKED: "Classification Locked",
      READY_FOR_REVIEW: "Ready for Review",
    },
    wizardStatuses: {
      NOT_STARTED: "Not Started",
      IN_PROGRESS: "In Progress",
      SUBMITTED: "Submitted",
    },
    nextActions: {
      wizardNotStarted:
        "Start the Wizard to describe how this AI system is used.",
      wizardInProgress: "Continue the Wizard to complete your assessment.",
      wizardSubmitted:
        "Waiting for technical evidence before classification can proceed.",
    },
    security: {
      title: "Account protection",
      description:
        "Set up MFA, update recovery email, and use the existing safe flows already supported by the backend.",
      openMfaEnroll: "Set up MFA",
      openRecovery: "Open password recovery",
      recoveryEmailLabel: "Recovery email",
      recoveryEmailDescription:
        "Add or change the recovery email without exposing secrets in the UI.",
      submit: "Save recovery settings",
      submitting: "Saving recovery settings",
      successTitle: "Security settings updated",
      successDetail:
        "Recovery settings were saved and audited through the current security flow.",
      errors: {
        recoveryEmailInvalid: "Enter a valid recovery email or leave it blank.",
        requestFailedTitle: "Unable to update settings",
        requestFailedDetail:
          "Security settings could not be updated right now. Please try again.",
      },
    },
    settingsHub: {
      description:
        "Manage account identity, MFA, recovery, sessions, and linked repositories with the current LCSP security flow.",
      sections: {
        account: "Account",
        appearance: "Appearance",
        notifications: "Notifications",
        emails: "Emails",
        passwordAndAuthentication: "Password and authentication",
        sessions: "Sessions",
        repositories: "Repositories",
      },
      labels: {
        account: "Account",
        displayName: "Display name",
        primaryEmail: "Primary email",
        organization: "Organization",
        membershipRole: "Membership role",
        createdAt: "Created",
        updatedAt: "Updated",
        recoveryEmail: "Recovery email",
        lastActiveAt: "Last active",
        expiresAt: "Expires",
        defaultBranch: "Default branch",
        linkedAssessment: "Linked assessment",
        connectedAt: "Connected",
      },
      badges: {
        verified: "Verified",
        unverified: "Unverified",
        mfaEnabled: "MFA enabled",
        mfaPending: "MFA pending",
        configured: "Configured",
        primary: "Primary",
        backup: "Backup",
        active: "Active",
        revoked: "Revoked",
      },
      states: {
        notConfigured: "Not configured",
        noRecoveryEmail: "No recovery email set",
        enabled: "On",
        disabled: "Off",
        currentSession: "Current session",
        noSessions: "No sessions found.",
        noRepositories: "No linked repositories found.",
        noAssessmentLinked: "No assessment linked",
      },
      actions: {
        edit: "Edit",
        manage: "Manage",
        setUp: "Set up",
        hide: "Hide",
        changePassword: "Change password",
        turnOn: "Turn on MFA",
        turnOff: "Turn off MFA",
        generateSetup: "Generate setup",
        verifyAndSave: "Verify and save",
        cancel: "Cancel",
        sendRecovery: "Send recovery instructions",
        updatePassword: "Update password",
        revoke: "Revoke",
        linkGitHub: "Link GitHub",
        linkGoogle: "Link Google",
        connectGitHubRepository: "Connect GitHub repository",
        manageGitHubRepositoryAccess: "Manage access",
      },
      account: {
        title: "Account",
        description:
          "Review the identity and workspace context attached to this LCSP session.",
        oauthTitle: "OAuth providers",
        oauthDescription:
          "Add an OAuth sign-in method only after this session is already authenticated.",
        oauthLinkSuccessTitle: "Provider linked",
        oauthLinkSuccessDescription:
          "This OAuth provider can now be used for future LCSP sign-ins.",
        oauthLinkFailedTitle: "Provider not linked",
        oauthLinkFailedDescription:
          "The OAuth provider could not be linked to this account.",
      },
      appearance: {
        title: "Appearance",
        description:
          "Keep the GitHub-style structure while staying inside the existing LCSP visual system.",
        shellTitle: "Current shell",
        shellDescription:
          "Appearance follows the active LCSP workspace shell. Account-level theme preferences are not persisted yet.",
      },
      notifications: {
        title: "Notifications",
        description:
          "Review which account emails receive recovery and security notices in the current system.",
        emailRoutingTitle: "Email routing",
        emailRoutingDescription:
          "Recovery and security messages use your primary email and the optional recovery email configured below.",
      },
      emails: {
        title: "Emails",
        description:
          "Manage the email addresses used to sign in, receive notifications, and recover access.",
        addressListTitle: "Emails you can use",
        addressListDescription:
          "Verified emails can be used for sign-in and security-related delivery in the current LCSP flow.",
        primaryTitle: "Primary email",
        primaryDescription:
          "Your primary email is used to sign in and receive security messages.",
        primaryRowDescription:
          "This address is the default destination for sign-in and account security activity.",
        recoveryRowDescription:
          "This address is stored as the current backup destination for recovery-related messages.",
        primaryMenuLabel: "Open primary email actions",
        recoveryMenuLabel: "Open backup email actions",
        addEmailTitle: "Add email address",
        addEmailInputLabel: "Email address",
        addEmailPlaceholder: "Email address",
        addEmailAction: "Add",
        addEmailDescription:
          "LCSP currently stores one additional recovery email for account recovery and security notifications.",
        primaryPreferenceTitle: "Primary email address",
        primaryPreferenceDescription:
          "Select the email used for account-related notifications and the default recovery identity.",
        backupPreferenceTitle: "Backup email address",
        backupPreferenceDescription:
          "Choose how backup delivery should behave for recovery and security events.",
        backupAllVerifiedOption: "Allow all verified emails",
      },
      reauth: {
        title: "Confirm access",
        description:
          "Confirm this sensitive settings change before continuing.",
        accountLabel: "Signed in as",
        passwordPlaceholder: "Password",
        otpPlaceholder: "XXXXXX",
        confirm: "Confirm",
        confirming: "Confirming",
        verify: "Verify",
        verifying: "Verifying",
        supportTitle: "Having problems?",
        useAuthenticator: "Use your authenticator app",
        usePassword: "Use your password",
        setUpMfa: "Set up MFA",
        close: "Close dialog",
      },
      password: {
        title: "Password and authentication",
        description:
          "Manage sign-in methods, authenticator-based MFA, and the recovery flow supported by LCSP today.",
        signInMethodsTitle: "Sign in methods",
        emailMethod: "Email",
        emailMethodDescription: "2 verified emails configured",
        passwordMethod: "Password",
        passwordMethodDescription: "Configured",
        currentPasswordLabel: "Old password",
        newPasswordLabel: "New password",
        confirmNewPasswordLabel: "Confirm new password",
        passwordPolicyHint:
          "Make sure it's at least 15 characters OR at least 8 characters including a number and a lowercase letter.",
        learnMoreLink: "Learn more",
        mfaTitle: "Two-factor authentication",
        mfaDescription:
          "Authenticator app setup is required before accessing the protected workspace.",
        authenticatorApp: "Authenticator app",
        authenticatorConfigured:
          "A TOTP authenticator is configured for this account.",
        authenticatorPending:
          "Generate a new authenticator setup and verify one code to finish enrollment.",
        inlineSetupTitle: "Authenticator setup",
        inlineSetupDescription:
          "Generate a QR code, scan it with your authenticator app, then verify one current code inline.",
        mfaVerifiedTitle: "Two-factor authentication verified",
        mfaDisabledTitle: "Two-factor authentication disabled",
        disableFailedTitle: "Unable to disable two-factor authentication",
        disableFailedDescription:
          "The current session could not disable MFA right now. Re-authenticate and try again.",
        recoveryTitle: "Recovery options",
        recoveryDescription:
          "Send recovery instructions through the current LCSP password recovery flow when you need to reset access.",
      },
      sessions: {
        title: "Sessions",
        description:
          "Review active and prior authenticated sessions for the current workspace scope.",
        activeTitle: "Web sessions",
        activeDescription:
          "Revoke sessions you no longer recognize without changing the current workspace layout.",
        summary: "Active sessions",
        revokedTitle: "Session revoked",
      },
      repositories: {
        title: "Repositories",
        description:
          "Review repositories linked to this account through the current LCSP GitHub integration.",
        connectTitle: "GitHub App connection",
        connectDescription:
          "Start the read-only GitHub App flow and select repositories authorized for trusted scan evidence.",
        connectSuccessTitle: "Repository connected",
        connectSuccessDescription:
          "LCSP stored the repository metadata without storing raw GitHub tokens.",
        connectFailedTitle: "Repository connection failed",
        connectFailedDescription:
          "The GitHub App authorization could not be completed for this workspace.",
        listTitle: "Linked repositories",
        listDescription:
          "Each linked repository is shown beside the assessment that currently uses it.",
        summary: "Linked repositories",
      },
      errors: {
        profileLoadTitle: "Unable to load settings",
        profileLoadDetail:
          "The account settings data could not be loaded right now. Please try again.",
        sessionActionDetail:
          "The session action could not be completed right now. Please try again.",
      },
    },
    errors: {
      workspaceUnavailableTitle: "Workspace unavailable",
      workspaceUnavailableDetail:
        "Workspace context cannot be loaded right now.",
      assessmentsUnavailableTitle: "Assessments unavailable",
      assessmentsUnavailableDetail:
        "Assessment list cannot be loaded right now.",
      createAssessmentTitle: "Unable to create assessment",
      createAssessmentDetail: "Please try again.",
    },
  },
  assessment: {
    eyebrow: "Assessment workflow",
    pageTitle: "Assessment overview",
    pageDescription:
      "Open the right workflow step to complete intake, check readiness, review classification, and manage compliance records.",
    openOverview: "Open assessment overview",
    moduleNavigation: "Assessment workflow steps",
    openModule: "Open this step",
    modules: {
      wizard: "Describe the business context and how the AI system is used.",
      readiness: "Review completed conditions and the evidence still needed.",
      classification:
        "Review the classification state and available next actions.",
      documents: "Generate, track, and download assessment documents.",
      conflicts: "Review and record decisions for pending conflicts.",
    },
  },
  assessmentForm: {
    pageTitle: "Create assessment",
    pageDescription: "Enter the basics before starting the Wizard intake.",
    formTitle: "Assessment details",
    formDescription: "You can add more detail in the next workflow steps.",
    nameLabel: "Assessment name",
    namePlaceholder: "Example: AI customer support assistant",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Briefly describe the AI system to assess.",
    cancel: "Cancel",
    submit: "Create and start Wizard",
    submitting: "Creating assessment",
  },
  developerManagement: {
    pageTitle: "Manage developers",
    pageDescription:
      "Grant and revoke Developer access for the current assessment scope.",
    inviteTitle: "Invite developer",
    emailLabel: "Work email",
    invite: "Send invitation",
    membersTitle: "Granted developers",
    scopeLabel: "Assessment scope",
    revoke: "Revoke access",
    empty: "No developers have been granted access to this assessment.",
  },
  wizard: {
    metadataTitle: "Assessment Wizard | LCSP",
    metadataDescription:
      "Describe the business context of this AI system in guided steps.",
    pageTitle: "Assessment Wizard",
    pageDescription:
      "Describe how this AI system is used before technical evidence is reviewed.",
    loading: "Loading wizard",
    loadingDetail: "Checking the current assessment state.",
    preScreenBadge: "Pre-screen",
    detailedBadge: "Detailed intake",
    progressLabel: "Progress",
    draftSaved: "Draft saved",
    draftSaving: "Saving draft",
    draftDirty: "Draft has unsaved changes",
    helperButton: "Why are we asking this?",
    helperClose: "Close helper",
    readOnlyBadge: "Read-only",
    landingTitle: "Start with the business context",
    landingDescription:
      "This step collects self-declared context in business language. It does not create a final legal conclusion.",
    timeEstimate: "Estimated time: about 10 minutes",
    readinessOnlyHint:
      "After submission, LCSP will keep this assessment in a readiness-only state until technical evidence is available.",
    preScreenTitle: "Quick pre-screen",
    preScreenDescription:
      "These opening questions help LCSP show the right detailed sections next.",
    readOnlyTitle: "This Wizard has already been submitted",
    readOnlyDescription:
      "The submitted profile cannot be edited from this page. Review the captured summary or continue with the next assessment step.",
    readOnlyEmpty:
      "No local summary is available on this device. The submitted Wizard remains locked.",
    summaryTitle: "Draft summary",
    summaryDescription:
      "Use this view to confirm what has been captured in the current browser session.",
    clearForm: "Clear form",
    helperTitle: "Guidance",
    helperDescription:
      "Examples and plain-language explanations for the current question.",
    actions: {
      backToWorkspace: "Back to workspace",
      previous: "Previous",
      saveAndContinue: "Save and continue",
      continueToDeepResearch: "Continue to deep research",
      continueToDetailed: "Continue to detailed intake",
      submit: "Submit Wizard",
      openClassification: "Open next step",
    },
    sections: {
      purpose: "System purpose",
      dataUsers: "Data and affected people",
      decision: "Decision making",
      provider: "External AI usage",
      deployment: "Deployment context",
      risk: "Special risk signals",
      deepResearch: "Deep research",
    },
    fields: {
      preAiScopeLabel:
        "Does this system use AI or generate AI-based suggestions or content?",
      preAiScopeDescription:
        "Choose the option that best matches the role of AI in this workflow today.",
      preAffectedPeopleLabel:
        "Could the result affect customers, staff, applicants, students, patients, or other people?",
      preAffectedPeopleDescription:
        "This helps LCSP understand who may be directly affected.",
      prePersonalDataLabel:
        "Does the system handle personal, sensitive, or biometric data?",
      prePersonalDataDescription:
        "If you are unsure, choose the option that keeps review cautious.",
      preDecisionImportanceLabel:
        "Could the AI result influence an important decision about a person?",
      preDecisionImportanceDescription:
        "For example: hiring, access, eligibility, pricing, or service outcomes.",
      businessProcessLabel: "What business process does this system support?",
      businessProcessDescription:
        "Describe the main business process, compliance/risk goal, and business users who benefit.",
      businessProcessPlaceholder:
        "Example: Help an organization assess AI-system compliance and risk before production use.",
      useCaseLabel: "What is the primary use case?",
      useCaseDescription:
        "Describe the actor goal, main flow, and boundary of this use case without listing implementation details.",
      useCasePlaceholder:
        "Example: A support agent opens a customer request, reviews suggested context, edits a draft reply, and sends it.",
      primaryActorsLabel: "Who participates in this use case?",
      primaryActorsDescription:
        "Name the human actors, system actors, and affected people involved in the workflow.",
      primaryActorsPlaceholder:
        "Example: Support agent, customer, customer support system, AI drafting service.",
      businessTriggerLabel: "What starts this workflow?",
      businessTriggerDescription:
        "Describe the event, user action, or scheduled condition that begins the use case.",
      businessTriggerPlaceholder:
        "Example: A customer submits a new support request or reopens an existing case.",
      expectedOutcomeLabel: "What outcome should the workflow produce?",
      expectedOutcomeDescription:
        "Describe the business result after the workflow completes, including what must not be decided by the AI.",
      expectedOutcomePlaceholder:
        "Example: The customer receives a staff-approved response; the AI does not close the case by itself.",
      aiPurposeLabel: "What role does the AI play in this process?",
      aiPurposeDescription:
        "Describe what the AI is used for and which decisions it must not approve by itself.",
      aiPurposePlaceholder:
        "Example: Support investigation planning, interpret evidence against approved rules, and propose cited conclusions.",
      autonomyLevelLabel: "How autonomous is the system in this use case?",
      autonomyLevelDescription:
        "Choose the strongest option that still matches the real workflow.",
      sectorLabel: "Which business context fits this system best?",
      sectorDescription:
        "Choose the closest sector; LCSP usually fits governance, risk and compliance.",
      dataTypeLabel: "What kinds of data does the system use or analyze?",
      dataTypeDescription:
        "Select every category that applies to the AI workflow.",
      affectedSubjectsLabel: "Who is directly affected by the result?",
      affectedSubjectsDescription:
        "Choose the group most directly affected by the system outcome.",
      userImpactLabel: "How strong is the impact on those people?",
      userImpactDescription:
        "Think about whether the output changes access, treatment, opportunities, or service quality.",
      decisionRoleLabel:
        "What role does the AI output play in the final decision?",
      decisionRoleDescription:
        "Choose the option that best reflects how much the result influences the outcome.",
      decisionRoleExamples:
        "Example: a suggestion for staff review is different from an output that directly determines an outcome.",
      humanReviewLabel:
        "Where does a person review the result before it takes effect?",
      humanReviewDescription:
        "This question appears when the AI output goes beyond simple background support.",
      externalLlmUsageLabel:
        "Does the system call an external AI provider such as OpenAI, Anthropic, Google, or another vendor?",
      externalLlmUsageDescription:
        "Select yes when prompts or content leave your environment for an outside provider.",
      biometricIndicatorLabel:
        "Does the system use biometric data for recognition, verification, or scoring?",
      biometricIndicatorDescription:
        "Examples include face, voice, fingerprint, or similar identity signals.",
      highImpactIndicatorLabel:
        "Does this workflow relate to hiring, education, credit, healthcare, public services, or another important life context?",
      highImpactIndicatorDescription:
        "This helps LCSP flag workflows that may need closer follow-up later.",
      deploymentContextLabel:
        "Who is the intended audience for this application?",
      deploymentContextDescription:
        "Identify whether the application is used internally or provided externally to other users.",
      specialCategoryDataLabel:
        "Does the data contain particularly sensitive special categories?",
      specialCategoryDataDescription:
        "For example: political opinions, religious beliefs, trade union membership, etc.",
      transparencyIndicatorsLabel:
        "Are there direct interactions or AI-generated content?",
      transparencyIndicatorsDescription:
        "Indicate if users know they are interacting with AI or AI-generated content.",
      prohibitedRiskSignalsLabel: "Are there any unacceptable risk signals?",
      prohibitedRiskSignalsDescription:
        "Social scoring, subliminal manipulation, or inferring sensitive traits are prohibited.",
    },
    options: {
      yes: "Yes",
      no: "No",
      unknown: "I am not sure yet",
      sectorGeneral: "General business operations",
      sectorHr: "Employment or HR",
      sectorFinance: "Finance, credit, or insurance",
      sectorEducation: "Education or training",
      sectorHealthcare: "Healthcare or wellness",
      sectorPublicServices: "Public services or regulated access",
      sectorGovernanceRiskCompliance:
        "Governance, Risk and Compliance / Legal-tech",
      dataTypePersonal: "Personal profile data",
      dataTypeSensitive: "Sensitive or special-category data",
      dataTypeBiometric: "Biometric data",
      dataTypeBehavioral: "Behavior or usage data",
      dataTypeOperational: "Operational or product data",
      userGroupCustomers: "Customers or end users",
      userGroupEmployees: "Employees or internal staff",
      userGroupApplicants: "Applicants or candidates",
      userGroupStudents: "Students or learners",
      userGroupPatients: "Patients or care recipients",
      userImpactLow: "Low impact",
      userImpactModerate: "Moderate impact",
      userImpactSignificant: "Significant impact",
      decisionRoleNoAutonomousDecision:
        "It supports background work only and does not shape a final decision",
      decisionRoleSupportsDecision:
        "It supports a person who still decides the outcome",
      decisionRoleInformsDecision:
        "It informs a person who still decides the outcome",
      decisionRoleRecommendsOutcome:
        "It recommends an outcome that people usually follow",
      decisionRoleDirectlyDrivesOutcome:
        "It directly drives the outcome with little or no review",
      humanOversightPresent:
        "A person reviews and can change the result before it takes effect",
      humanOversightLimited:
        "A person reviews some cases, but not every result",
      humanOversightAbsent:
        "The result usually takes effect without meaningful review",
      humanOversightNotApplicable:
        "Not applicable because the AI does not influence a final decision",
      autonomyHumanAssisted:
        "Human-assisted only; people decide and execute the outcome",
      autonomyHumanApprovalRequired:
        "Automation prepares an outcome, but human approval is required",
      autonomyConditionalAutomation:
        "Automation can act in defined conditions or low-risk cases",
      autonomyFullAutomation:
        "The system can complete the outcome without human approval",
      externalNone: "No external calls",
      externalPossible: "Possible external service calls",
      externalConfirmed: "Confirmed external AI usage",
      deploymentInternal: "Internal use",
      deploymentExternal: "External deployment",
      highImpactRecruiting: "Recruiting and HR",
      highImpactCredit: "Credit and finance",
      highImpactEducation: "Education",
      highImpactHealthcare: "Healthcare",
      transparencyDirectInteraction: "Direct interaction (Chatbots, etc.)",
      transparencyContentGeneration: "Content generation (Text, Images, etc.)",
      prohibitedTracking: "Non-transparent tracking",
      prohibitedManipulation: "Behavioral manipulation",
      prohibitedScoring: "Social scoring",
      prohibitedSensitiveInference: "Inferring sensitive traits",
    },
    clarification: {
      title: "Context needed before scan",
      description:
        "Answer these bounded questions so later agents use supplied facts instead of inferring business intent from code names.",
      badge: "Ask mode",
      askAction: "Ask follow-up",
      askRunning: "Asking",
      askReady: "Follow-up questions ready",
      approveAction: "Approve",
      approveDescription:
        "Approve this question batch after all answers are complete so Deep Agents can continue analysis.",
      approveIncomplete:
        "Answer every question in the current batch before approving.",
      approveReady:
        "Question batch approved. Deep Agents will continue analysis.",
      noMoreQuestions: "Deep Agents have no new deep research questions.",
      agentTitle: "Follow-up questions from the agent",
      agentDescription:
        "These questions were generated from the current assessment context and routed to the matching Wizard fields.",
      agentBadge: "Agent ask",
      agentReasonLabel: "Reason",
      agentAnswerLabel: "Answer",
      agentAnswerDescription:
        "Answer with business context only. Do not paste source code or prompts.",
      agentAnswerPlaceholder:
        "Add the missing context needed to continue planning or investigation.",
      rules: {
        businessProcess:
          "Collect the everyday business workflow in user language, not code structure.",
        useCase:
          "Collect one primary actor goal, main flow, and boundary for this assessment.",
        primaryActors:
          "Collect only roles that act in or are affected by the use case.",
        businessTrigger:
          "Collect the business event that starts the flow; do not infer it from route names alone.",
        expectedOutcome:
          "Collect the intended business output and any decision that needs human authority.",
        autonomyLevel:
          "Collect one bounded automation level from the approved option set.",
        aiPurpose:
          "Collect what AI is used for and what it must not decide alone.",
        sector: "Collect the closest sector from the approved option set.",
        postGraphContext:
          "Ask only for missing domain context that the code graph cannot prove.",
        postGraphRuleScope:
          "Ask only which business scope or rule area should be evaluated next.",
        postGraphHumanReview:
          "Ask only where human review or approval sits in the business flow.",
      },
      useCaseQuestion: "What is the primary use case?",
      useCaseDetail:
        "Include the actor goal, main flow, and boundary. Do not include source code or implementation details.",
      primaryActorsQuestion: "List the actors involved.",
      primaryActorsDetail:
        "Include human actors, system actors, and affected people. Use plain role names.",
      businessTriggerQuestion: "What starts this flow?",
      businessTriggerDetail:
        "Name the user action, event, queue message, schedule, or external condition that begins the use case.",
      expectedOutcomeQuestion: "What outcome should this flow produce?",
      expectedOutcomeDetail:
        "State the business result and call out decisions that AI must not make alone.",
      autonomyLevelQuestion: "How autonomous is the system in this use case?",
      autonomyLevelDetail:
        "Select whether the AI only assists, needs approval, can act conditionally, or fully automates the result.",
      postGraphContextQuestion:
        "What business context is missing from the code graph?",
      postGraphContextDetail:
        "Add only domain facts needed to interpret the scanned technical evidence.",
      postGraphContextPlaceholder:
        "Example: This route is used only by compliance operators during evidence review.",
      postGraphRuleScopeQuestion:
        "Which rule area should the planner evaluate next?",
      postGraphRuleScopeDetail:
        "Name the business obligation, control area, or approved corpus scope that should guide the next investigation.",
      postGraphRuleScopePlaceholder:
        "Example: Human oversight and auditability for AI-assisted classification.",
      postGraphHumanReviewQuestion:
        "Where does human review happen in this flow?",
      postGraphHumanReviewDetail:
        "State who reviews, when the review happens, and what authority they have.",
      postGraphHumanReviewPlaceholder:
        "Example: Legal Operator reviews blocked classifications before final approval.",
    },
    deepResearch: {
      badge: "Deep Agents",
      description:
        "Deep Agents automatically generate questions after the sections above are complete, based on existing answers and without routing back into existing Wizard fields.",
      lockedDescription:
        "Complete every section above so Deep Agents can start deep research automatically.",
      lockedError:
        "Complete every section above before asking Deep Agents for deep research.",
      agentTitle: "Automatic deep research",
      agentDescription:
        "Deep Agents read the current Wizard context and add post-scan questions when no generated question is waiting for an answer.",
      askAction: "Generate questions",
    },
    helpers: {
      decisionTitle: "How to answer the decision question",
      decisionBody:
        "Choose the strongest statement that still feels true. If the AI output can approve, reject, rank, or gate people with limited review, select a stronger decision role.",
      humanOversightTitle: "What counts as meaningful human review",
      humanOversightBody:
        "A meaningful review happens before the result takes effect and gives a person real authority to question, change, or stop it.",
      providerTitle: "When external provider usage matters",
      providerBody:
        "Select yes when your team sends prompts, documents, or user content to a third-party AI service outside your controlled environment.",
    },
    errors: {
      loadTitle: "Unable to load this Wizard",
      loadDetail: "The assessment state could not be loaded right now.",
      clarificationFailed:
        "Follow-up questions could not be generated. Try again.",
      saveFailed: "The draft could not be saved. Try again.",
      submitFailed:
        "The Wizard could not be submitted. Review the highlighted answers and try again.",
      alreadySubmitted:
        "This Wizard has already been submitted and is now read-only.",
      preAiScopeRequired:
        "Please indicate whether this system uses AI before continuing.",
      preAffectedPeopleRequired:
        "Please select who might be affected before continuing.",
      prePersonalDataRequired:
        "Please indicate whether personal data is processed before continuing.",
      preDecisionImportanceRequired:
        "Please indicate whether the AI output affects an important decision before continuing.",
      businessProcessRequired:
        "Describe the main business process before continuing.",
      useCaseRequired: "Describe the primary use case before continuing.",
      primaryActorsRequired: "Describe the actors involved before continuing.",
      businessTriggerRequired:
        "Describe what starts the workflow before continuing.",
      expectedOutcomeRequired:
        "Describe the expected outcome before continuing.",
      aiPurposeRequired: "Describe the AI purpose before continuing.",
      autonomyLevelRequired: "Choose the autonomy boundary before continuing.",
      sectorRequired: "Choose the primary business context before continuing.",
      dataTypesRequired: "Select at least one data category before continuing.",
      affectedSubjectsRequired:
        "Choose who is directly affected before continuing.",
      userImpactRequired: "Choose the level of impact before continuing.",
      decisionRoleRequired:
        "Choose how strongly the AI output affects the final decision.",
      humanReviewRequired:
        "Describe where a person reviews the result before continuing.",
      externalLlmUsageRequired:
        "Confirm whether the system uses an external AI provider before continuing.",
      deploymentContextRequired:
        "Select the intended audience before continuing.",
      specialCategoryDataRequired:
        "Indicate whether special category data is processed before continuing.",
      biometricDataRequired:
        "Indicate whether biometric data is processed before continuing.",
      highImpactIndicatorsRequired:
        "Select any high impact indicators before continuing.",
      prohibitedRiskSignalsRequired:
        "Select any prohibited risk signals before continuing.",
    },
  },
  readiness: {
    metadataTitle: "Readiness status | LCSP",
    metadataDescription:
      "Review the readiness-only handoff after the Wizard is submitted.",
    pageTitle: "Readiness status",
    pageDescription:
      "This view shows what is ready, what is still missing, and the next safe step before classification can proceed.",
    loading: "Loading readiness status",
    loadingDetail: "Checking the latest Wizard and evidence state.",
    errorTitle: "Unable to load readiness status",
    errorDetail: "Please try again in a moment.",
    badgeReadinessOnly: "Readiness only",
    badgeLocked: "Locked",
    badgeReady: "Ready for the next gate",
    summaryTitle: "Current handoff",
    summaryDescription:
      "The Wizard is complete, but LCSP still treats this assessment as readiness-only until technical evidence is available.",
    summaryDescriptionReady:
      "The required technical evidence is available and this assessment can proceed to the next controlled gate.",
    exportErrorTitle: "Unable to generate readiness export",
    exportErrorDetail:
      "The PDF could not be generated. Confirm that the Wizard is submitted and technical evidence is still unavailable.",
    completedTitle: "Completed steps",
    missingTitle: "Still missing",
    nextActionTitle: "Next action",
    updatedAtLabel: "Updated",
    noMissingEvidence: "There are no missing readiness items at the moment.",
    noCompletedSteps: "No readiness milestones have been confirmed yet.",
    unresolvedTitle: "Unresolved Business Context",
    unresolvedDescription:
      "These items need further clarification before classification can proceed.",
    noUnresolvedItems: "No unresolved items.",
    unresolvedItemLabels: {
      affectedSubjects: "Affected subjects not yet confirmed",
      dataTypes: "Data types not yet confirmed",
      specialCategoryData: "Special category data status unclear",
      biometricData: "Biometric data usage unclear",
      humanReview: "Human review oversight unclear",
      externalLlmUsage: "External LLM usage unclear",
      highImpactIndicators: "High-impact context not yet confirmed",
      prohibitedRiskSignals: "Prohibited risk signals not yet assessed",
    },
    classificationLockedReason:
      "Repository evidence is required before classification can be performed.",
    completedSteps: {
      wizardProfile: "Wizard profile submitted",
      repositoryConnected: "Repository connected",
      technicalEvidenceAccepted: "Technical evidence accepted",
    },
    missingEvidence: {
      repositoryConnection: "Connect the repository used by this system.",
      technicalEvidence:
        "Wait for the repository scan to produce accepted technical evidence.",
    },
    actions: {
      backToWorkspace: "Back to workspace",
      openClassification: "Open classification status",
      openDocuments: "Open documents",
      connectRepository: "Connect Repository",
      editWizard: "Update Wizard",
      downloadPdf: "Download Wizard Readiness PDF",
      exportingPdf: "Preparing PDF...",
    },
  },
  technicalEvidence: {
    pageTitle: "Technical evidence",
    pageDescription:
      "Monitor repository scan runtime and evidence acceptance for this assessment.",
    connectionConnecting: "Connecting to runtime",
    connectionConnected: "Runtime connected",
    connectionDisconnected: "Reconnecting to runtime",
    scanJobsTitle: "Repository scans",
    evidenceReportsTitle: "Evidence reports",
    orchestrationTitle: "Orchestration log",
    awaitingEvent: "Waiting for a runtime event",
    lastUpdated: "Last updated",
    noScanJobs: "No runtime scan is available for this assessment.",
    noEvidenceReports: "No evidence report is available for this assessment.",
    noOrchestrationActivity: "No orchestration activity is available yet.",
    scanJobLabel: "Scan job",
    evidenceReportLabel: "Evidence report",
    updatedAt: "Updated",
    createdAt: "Created",
    attemptLabel: "Attempt",
    inputSummaryLabel: "Input",
    outputSummaryLabel: "Output",
    errorSummaryLabel: "Error",
    waitingReasonLabel: "Waiting reason",
    activeStepLabel: "Active step",
    runningStepsLabel: "Running",
    waitingStepsLabel: "Waiting",
    completedStepsLabel: "Completed",
    failedStepsLabel: "Warnings",
    skippedStepsLabel: "Skipped",
    noActiveStep: "No active step",
    nonBlockingFailureLabel: "Warning",
    logDetailsHint: "Click to view log details",
    messageLabel: "Message",
    reasonLabel: "Reason",
    valueLabel: "Value",
    emptyValueLabel: "Empty",
    notApplicableValueLabel: "Not applicable",
    rerunScan: "Run scan again",
    rerunningScan: "Creating new scan",
    rerunError: "Unable to create a new scan. Please try again.",
    clarificationRequestTitle: "Additional context requested",
    clarificationRequestDescription:
      "The pipeline has paused on bounded questions. Answer them in the Wizard so later agents use supplied facts.",
    clarificationRequestScopeLabel: "Scope",
    clarificationRequestReasonLabel: "Reason",
    clarificationRequestOpenWizard: "Open Wizard",
    clarificationCollectionRuleLabel: "Collection rule",
    scanStatuses: {
      queued: "Queued",
      running: "Analyzing",
      completed: "Completed",
      failed: "Failed",
      blocked: "Blocked",
      pending: "Pending",
    },
    evidenceStatuses: {
      accepted: "Accepted",
      rejected: "Rejected",
    },
    runtimeStatuses: {
      running: "Running",
      waiting: "Waiting",
      completed: "Completed",
      failed: "Failed",
      skipped: "Skipped",
    },
    runtimeStages: {
      snapshot: "Snapshot",
      scan: "Scan",
      technicalEvidence: "Technical evidence",
      technicalProfile: "Technical profile",
      aiUsageFlow: "AI usage flow",
      reconciliation: "Reconciliation",
      classification: "Classification",
      conflicts: "Conflicts",
      documents: "Documents",
      legalRetrieval: "Legal retrieval",
    },
    runtimeEvents: {
      runStarted: "Run started",
      runStageChanged: "Stage changed",
      toolStarted: "Tool started",
      toolCompleted: "Tool completed",
      toolFailed: "Tool failed",
      toolWaitingInput: "Waiting for input",
      toolSkipped: "Tool skipped",
      runCompleted: "Run completed",
      runFailed: "Run failed",
    },
    runtimeToolLabels: {
      runStarted: "Assessment pipeline started",
      runCompleted: "Assessment pipeline completed",
      runFailed: "Assessment pipeline failed",
      stageChanged: "Entered stage",
      getScanCoverage: "Read scan coverage",
      searchEvidence: "Search technical evidence",
      getFindingDetail: "Read finding detail",
      findProviderInvocations: "Find AI provider invocations",
      getEvidenceSubgraph: "Read evidence subgraph",
      getSymbolContext: "Read symbol context",
      traceStaticFlow: "Trace static data flow",
      inspectHumanReviewPath: "Inspect human review path",
      inspectDecisionPath: "Inspect decision path",
      inspectDataPath: "Inspect data path",
      findSimilarSymbols: "Find similar symbols",
      inspectDeploymentContext: "Inspect deployment context",
      requestTargetedReanalysis: "Request targeted reanalysis",
      getAssessmentContext: "Read assessment context",
      getArtifactChain: "Read artifact chain",
      proposeMissingTargets: "Propose missing targets",
      getReconciliationContext: "Read reconciliation context",
      getVerifiedProfile: "Read verified profile",
      compareWizardClaim: "Compare wizard claim",
      reconcileProfileToVerifiedProfile:
        "Reconcile profile to verified profile",
      getClassificationBaseline: "Read classification baseline",
      getGapRequirements: "Read gap requirements",
      validateClassificationProposal: "Validate classification proposal",
      evaluateGapMatrix: "Evaluate gap matrix",
      getGapEvidenceTrace: "Read gap evidence trace",
      proposeGapRemediation: "Propose gap remediation",
      submitClassificationForIndependentReview: "Submit for independent review",
      resolveIndependentClassificationReview:
        "Resolve independent classification review",
      getLegalCorpusReadiness: "Check legal corpus readiness",
      retrieveLegalBasis: "Retrieve legal basis",
      getLegalRuleMatch: "Match legal rule",
      validateCitationSet: "Validate citation set",
      extractOfficialText: "Extract official text",
      runOcrFallback: "Run OCR fallback",
      evaluateOcrQuality: "Evaluate OCR quality",
      buildLegalChunks: "Build legal chunks",
      validateChunkIntegrity: "Validate chunk integrity",
      buildLegalRetrievalIndex: "Build legal retrieval index",
      resumeWaitingRuns: "Resume waiting runs",
      investigateEngineeringRule: "AI investigating engineering rule",
      scanWorkspaceMaterialized: "Workspace materialized",
      scanLanguageClassified: "Language classification completed",
      scanToolExecuted: "Scan tool executed",
      scanToolProvenanceRecorded: "Scan provenance recorded",
    },
    runtimeToolDetail: {
      sbomEntries: "SBOM entries",
      findings: "findings",
      dependencyFacts: "dependency facts",
      classifiedFiles: "classified files",
      extractedFiles: "extracted files",
      items: "items",
      coverageState: "coverage",
      status: "status",
      aiInvestigationNode: "AI node",
    },
  },
  workspaceSelector: {
    metadataTitle: "Select workspace | LCSP",
    metadataDescription: "Select an organization workspace to continue.",
    eyebrow: "Developer account",
    title: "Choose a workspace",
    description:
      "Your account can belong to multiple workspaces managed by different Managers.",
    welcomeBackTitle: "Welcome back!",
    welcomeBackDescription: "Choose from an existing workspace to continue.",
    continueExistingWorkspaces: "OR continue to existing workspaces",
    readyToLaunch: "Ready to launch",
    missingSomething: "Missing something?",
    signInAnotherAccount: "Sign in to another account",
    members: "members",
    lastSignIn: "Last sign-in",
    daysAgo: "days ago",
    dayAgo: "day ago",
    signedInAs: "Signed in as",
    workspaceListLabel: "Workspaces you can access",
    loading: "Loading workspaces",
    submit: "Continue",
    selected: "Selected",
    openWorkspace: "Open workspace",
    signOut: "Sign out of this account",
    noWorkspacesTitle: "No workspaces",
    noWorkspacesDetail:
      "This demo account is not linked to any workspaces yet.",
    errorTitle: "Unable to load workspaces",
    errorDetail: "Sign in again or try later.",
    privacyTerms: "Privacy & Terms",
    contactUs: "Contact Us",
    changeRegion: "Change region",
  },
  reconciliation: {
    metadataTitle: "Conflict resolution | LCSP",
    metadataDescription:
      "Review pending scan conflicts and record a resolution decision.",
    pageTitle: "Conflict resolution",
    pageDescription:
      "Resolve or dismiss each pending conflict. Dismissal requires a reason.",
    loading: "Loading pending conflicts",
    pendingSectionLabel: "Pending conflicts",
    pendingBadge: "Pending",
    scoreLabel: "Conflict score",
    scorePriorityLabel: "Review priority",
    affectedFieldLabel: "Affected field",
    confidenceLabel: "Confidence",
    materialityReasonLabel: "Materiality reason",
    sourceValuesLabel: "Source values",
    managerAnswerLabel: "Manager answer",
    technicalEvidenceLabel: "Technical evidence",
    evidenceBasisLabel: "Evidence basis",
    redactedContextLabel: "Redacted context",
    coverageLimitationsLabel: "Coverage limitations",
    notProvided: "Not provided",
    evidenceRefsLabel: "Evidence references",
    resolutionLabel: "Resolution",
    resolutionResolved: "Resolved",
    resolutionDismissed: "Dismissed",
    resolutionNoteLabel: "Resolution note",
    resolutionNotePlaceholder:
      "Add context for this decision. Required when you dismiss a conflict.",
    submitAction: "Submit resolution",
    submitting: "Submitting",
    allResolvedTitle: "All conflicts are resolved",
    allResolvedDetail:
      "There are no pending conflicts for this assessment right now.",
    nextStepHint: "You can continue with the assessment workflow.",
    nextStepAction: "Back to assessments",
    accessRevokedTitle: "Access no longer available",
    accessRevokedDetail:
      "You no longer have permission to view or resolve conflicts for this assessment.",
    errorTitle: "Unable to load conflicts",
    errorDetail: "Please try again in a moment.",
    conflictTypeLabels: {
      evidenceContradiction: "Evidence contradiction",
      scopeMismatch: "Scope mismatch",
      unverifiableFinding: "Unverifiable finding",
      generic: "Conflict",
    },
    errors: {
      dismissReasonRequired: "Enter a reason before dismissing this conflict.",
      alreadyResolved:
        "This conflict was already processed. The list has been refreshed.",
      conflictNotFound:
        "This conflict is no longer available. The list has been refreshed.",
      resolveFailed:
        "The resolution request could not be completed. Please try again.",
    },
  },
  classification: {
    metadataTitle: "Classification status | LCSP",
    metadataDescription:
      "Review the current classification status for this assessment.",
    pageTitle: "Classification status",
    pageDescription:
      "Track the current classification progress and the next step for this assessment.",
    loading: "Loading classification status",
    summaryLabel: "Summary",
    referencesLabel: "Applicable legal references",
    generateFinalReport: "Generate Final Report",
    generateGapAnalysis: "Generate Gap Analysis",
    rerunClassification: "Retry classification",
    rerunSubmitting: "Queueing classification",
    errorTitle: "Unable to load classification status",
    errorDetail: "Please try again in a moment.",
    verifiedProfileReview: {
      title: "Evidence profile review",
      description:
        "Review the evidence-backed assessment facts before legal matching and classification begin.",
      verificationSourceLabel: "Verification source",
      evidenceChainLabel: "Evidence chain",
      evidenceChainVerified: "Verified",
      evidenceChainNeedsReview: "Needs review",
      providerVersionLabel: "Provider version",
      verificationSources: {
        TECHNICAL_PLUS_WIZARD: "Technical evidence and wizard answers",
        UNKNOWN: "Not provided",
      },
      factsTitle: "Assessment facts",
      noClaims: "No assessment facts were included.",
      unknownClaimTitle: "Assessment fact",
      claimIdLabel: "Fact reference",
      claimTypeLabel: "Fact area",
      claimFieldLabel: "Assessment field",
      confidenceLabel: "Confidence",
      lifecycleStateLabel: "State",
      materialityLabel: "Material",
      evidenceSummaryLabel: "Evidence",
      evidenceItemLabel: "evidence item attached",
      evidenceItemsLabel: "evidence items attached",
      notProvided: "Not provided",
      yes: "Yes",
      no: "No",
      conflictSummary: "reconciliation decisions are attached to this profile.",
      approvalFailedTitle: "Approval failed",
      approvalFailedDetail:
        "The profile was not approved. Refresh the assessment and confirm that it is still pending approval.",
      approveButton: "Approve evidence profile",
      approvingButton: "Approving",
      approvedMessage: "Approved. Legal matching can proceed automatically.",
      statuses: {
        PENDING_APPROVAL: "Pending approval",
        APPROVED: "Approved",
        REJECTED: "Rejected",
        UNKNOWN: "Review required",
      },
      claimTitles: {
        MODEL_PROVIDER_USAGE: "AI provider usage",
        MODEL_INVOCATION: "AI model invocation",
        PERSONAL_DATA_INPUT: "Personal data input",
        HUMAN_REVIEW: "Human review",
        AFFECTED_SUBJECTS: "Affected people or groups",
        BUSINESS_PROCESS: "Business process",
        AI_PURPOSE: "AI purpose",
        UNKNOWN: "Assessment fact",
      },
      claimDescriptions: {
        model_provider_usage:
          "Whether the system uses an external or internal AI provider.",
        model_invocation:
          "Whether the repository contains code paths that invoke an AI model.",
        personal_data_input:
          "Whether personal data appears to be sent into the AI workflow.",
        human_review:
          "Whether human review is part of the AI-assisted process.",
        affected_subjects:
          "The people or groups affected by the AI-assisted process.",
        business_process: "The business workflow where AI assistance is used.",
        ai_purpose: "The purpose of the AI-assisted functionality.",
      },
      confidenceLevels: {
        low: "Low",
        medium: "Medium",
        high: "High",
        unknown: "Unknown",
      },
      lifecycleStates: {
        DETECTED: "Detected",
        ABSTAINED: "Not concluded",
        INFERRED: "Inferred",
        CONFIRMED: "Confirmed",
        UNKNOWN: "Unknown",
      },
    },
    states: {
      lockedTitle: "Classification is locked",
      lockedBadge: "Locked",
      lockedDescription:
        "Technical evidence is still required before classification can proceed.",
      lockedNextSteps:
        "Add the missing technical evidence so the classification can continue and the next step can be prepared.",
      waitingLegalReadinessTitle: "Preparing legal basis",
      waitingLegalReadinessBadge: "Preparing legal data",
      waitingLegalReadinessDescription:
        "The evidence profile is approved. Orchestration will continue automatically after the official legal corpus, retrieval index, and approved rule catalog are ready.",
      processingTitle: "Classification is in progress",
      processingBadge: "Processing",
      processingDescription: "The classification is still being prepared.",
      passedTitle: "Classification is ready",
      passedBadge: "Ready",
      passedDescription:
        "The available legal references were verified and the classification can proceed.",
      passedSummary: "Applicable legal references are ready for the next step.",
      degradedTitle: "Classification needs review",
      degradedBadge: "Needs review",
      degradedDescription: "Some legal references could not be fully verified.",
      degradedSummary:
        "The classification is available, but a few references need review.",
      blockedTitle: "Classification could not be completed",
      blockedBadge: "Blocked",
      blockedDescription:
        "The classification could not be completed because the citation basis was missing.",
      blockedSummary:
        "A valid citation basis is required before the next step can proceed.",
      legalMatchBlockedTitle: "No applicable legal rules found",
      legalMatchBlockedBadge: "No match",
      legalMatchBlockedDescription:
        "The legal matching step completed but found no rules that apply to the verified evidence profile. Classification cannot proceed without an applicable legal basis.",
      legalMatchBlockedSummary:
        "Contact your compliance administrator to review the rule catalog or evidence profile before retrying.",
    },
    finalReportRequestedTitle: "Final report request submitted",
    finalReportRequestedDetail:
      "The final report request is queued. You can return later to download it once processing is complete.",
    documentsPageDescription:
      "Request the final report and view the output status for this assessment.",
    finalReportPageHint:
      "Request a guarded final report. This is only available when the classification guardrail has passed.",
    requestFinalReportButton: "Request Final Report",
    gapAnalysisLabel: "Gap analysis",
    gapAnalysisPendingMessage:
      "Gap analysis is generated by the next worker stage after classification. It will be available when the document pipeline is ready.",
    documentGuardrailBlocked:
      "The final report cannot be generated because the classification guardrail has not passed.",
    documentList: {
      title: "Assessment documents",
      description:
        "Track the generation status of available assessment documents.",
    },
    documentMeta: {
      requestedAt: "Requested",
    },
    documentTypes: {
      finalReport: "Final report",
      gapAnalysis: "Gap analysis",
      readinessExport: "Readiness export",
      unknown: "Document",
    },
    documentStates: {
      queued: "Being prepared",
      generating: "Generating",
      ready: "Ready",
      failed: "Generation failed",
      blocked: "Blocked",
      unknown: "Pending",
      failedDetail: "Generation failed. Please try again.",
      permissionDenied: "Download is restricted for your current scope.",
    },
    documentActions: {
      download: "Download",
    },
  },
  legalLibrary: {
    metadataTitle: "Legal library | LCSP",
    metadataDescription:
      "Review Vietnamese legal documents used as reference material in LCSP.",
    pageTitle: "Legal documents",
    pageDescription:
      "Read the copy retained in LCSP and compare it with the official Government publication.",
    officialSourceLabel: "Official source",
    readDocument: "Read document",
    openOfficialSource: "Open Government source",
    downloadDocument: "Download PDF",
    documentReferenceLabel: "Reference",
    issuedOnLabel: "Issued",
    effectiveOnLabel: "Effective",
    authorityLabel: "Authority",
    documentUnavailableTitle: "Document not found",
    documentUnavailableDescription:
      "The requested document is not available in this workspace legal library.",
    riskTableTitle: "Processed legal risk",
    riskTableDescription:
      "Source-page chunks from the original documents, prioritized for review in the LCSP workflow.",
    riskTableDisclaimer:
      "Risk level is an LCSP review priority and not a legal conclusion.",
    chunkIdLabel: "Chunk",
    documentLabel: "Document",
    locatorLabel: "Source range",
    riskLevelLabel: "Risk level",
    riskLevels: {
      LOW: "Low",
      MEDIUM: "Medium",
      HIGH: "High",
    },
    documents: {
      aiLaw: {
        title: "Law on Artificial Intelligence",
        reference: "134/2025/QH15",
        issuedOn: "10 Dec 2025",
        effectiveOn: "1 Mar 2026",
        authority: "National Assembly",
      },
      digitalTechnologyIndustryLaw: {
        title: "Law on Digital Technology Industry",
        reference: "71/2025/QH15",
        issuedOn: "14 Jun 2025",
        effectiveOn: "1 Jan 2026",
        authority: "National Assembly",
      },
    },
  },
} as const satisfies PagesMessages;
