export const enLegalRuleCatalog = {
  title: "Build a Preparation Rule Set",
  description:
    "Choose canonical Legal Rules from the indexed source. Prepare only your selection, then inspect or regenerate each result independently.",
  catalog: "Legal Rule catalog",
  chooseCatalog: "Choose a catalog",
  emptyCatalog:
    "No Legal Rule catalog is available. Create a catalog and explicitly add rules to continue.",
  createCatalog: "Create catalog",
  createCatalogDescription:
    "Select an indexed legal source to create a new rule catalog.",
  version: "Catalog version",
  sourceId: "Chunked Legal Source version ID",
  sourceIdHelp:
    "Paste the Legal Source Version ID (UUID). You can copy this ID from the Version Summary card in Legal Sources.",
  create: "Create",
  addRule: "Add Legal Rule",
  manualAddRule: "Add rule manually",
  editRule: "Edit Legal Rule",
  ruleId: "Stable Legal Rule ID",
  ruleTitle: "Rule title",
  ruleDescription: "Rule description",
  citations: "Citation locators",
  citationHelp:
    "One document ID and exact locator per line, separated by |. References must resolve inside this catalog's indexed source.",
  save: "Save rule",
  saved: "Rule saved",
  search: "Search rules",
  status: "Preparation state",
  allStates: "All states",
  preparedWithAssessmentRules: "Prepared with Assessment Rules",
  assessmentRuleCount: "Assessment Rules",
  selectForActivation: "Select for activation",
  activateSelectedAssessmentRules: "Activate selected Assessment Rules",
  activationSelectedCount: "Selected prepared results",
  activateConfirmTitle: "Activate selected Assessment Rules?",
  activateConfirmDescription:
    "These selected persisted results will form the next ACTIVE Rule Set and replace the current one, if present.",
  activateConfirmImpact:
    "The new Rule Set contains only Assessment Rules from these selected results. Existing Assessments keep their pinned version; new Assessments use the replacement.",
  currentActiveRuleCount: "Assessment Rules in the current ACTIVE Rule Set",
  noActiveRuleSet: "No ACTIVE Rule Set is currently published",
  activating: "Activating…",
  activationSuccess: "Selected rules are now in ACTIVE Rule Set",
  empty: "No rules match these filters.",
  emptyCatalogRulesTitle: "This catalog has no rules yet",
  emptyCatalogRules:
    "Click the button below to browse documents and automatically add legal rules from the indexed source.",
  browseSourceDocuments: "Pick rules from source documents",
  sourcePickerTitle: "Select Legal Rules from source documents",
  sourcePickerDescription:
    "Select eligible legal leaves and review their composed Article, Clause, and Point context before importing.",
  documentsInSource: "Document files",
  provisionsInFile: "Provisions / rules in file",
  selectAllInPage: "Select all on page",
  deselectAll: "Deselect all",
  selectedProvisionsCount: "Selected provisions",
  addSelectedRulesToCatalog: "Add selected rules to catalog",
  noDocumentsInSource: "No documents found in this legal source.",
  noChunksInDocument: "No provisions indexed for this document.",
  noEligibleEffectiveProvisions:
    "Provisions are indexed, but none currently have a source-backed EFFECTIVE status.",
  sourceEffectNotEligibleNotice:
    "Chunks with UNKNOWN, REPEALED, or FUTURE status remain in Legal Source but cannot be imported. If an authoritative source confirms a status, update its legal-effect metadata and source reference in a DRAFT version.",
  eligibleLeafProvisions: "eligible provisions",
  compositionPreview: "Composed legal context",
  // Reference previews distinguish confirmed excerpts from uncertain targets.
  referenceContext: "Referenced provisions",
  referenceAmbiguous: "Several provisions match this reference.",
  referenceUnresolved: "The referenced provision could not be identified.",
  // Identify the original source as the document containing the reference.
  referenceOrigin: "Document containing the reference",
  referenceOpenSource: "Open source document",
  referenceTruncated: "Excerpt shortened.",
  articleLevel: "Article",
  clauseLevel: "Clause",
  pointLevel: "Point",
  unresolvedContentNotice:
    "Some source text could not be classified and remains available for legal review.",
  selectedDocumentFiles: "documents",
  sourceSelectLabel: "Legal source",
  chooseSource: "Choose legal source",
  importSuccess: "Successfully added rules to catalog.",
  importing: "Adding rules to catalog…",
  selectedFromFiles: "Selected rules across files",
  selectFileToViewProvisions:
    "Select a document file from the left list to view its provisions.",
  autoCreateCatalog: "Create catalog for this source",
  selectRule: "Select rule",
  selectAll: "Select all matching eligible rules",
  clear: "Clear selection",
  selected: "Selected rules",
  acrossPages:
    "Selection is retained across pages and filters. Only clearing it or changing catalogs changes its scope.",
  prepare: "Prepare selected rules",
  previous: "Previous page",
  next: "Next page",
  page: "Page",
  total: "Matching rules",
  eligible: "Eligible rules",
  confirm: "Confirm preparation",
  confirmCount: "Exact number of selected rules",
  confirmScope: "Persisted selection scope",
  confirmDescription:
    "The build contains exactly these canonical IDs and pinned inputs. Successful results for identical inputs are reused; use Re-analyze to generate a new revision.",
  cancel: "Cancel",
  error:
    "The request failed. Refresh the catalog and retry; stale selections must be cleared and selected again.",
  loading: "Loading…",
  noSelection: "Choose at least one eligible rule to continue.",
  batch: "Prepared Rule Set",
  selectedCount: "Selected",
  preparedCount: "Prepared",
  failedCount: "Failed / interrupted",
  skippedCount: "Reused / already in progress",
  complete: "Preparation finished",
  partial: "Preparation in progress",
  retryFailed: "Retry failed or interrupted rules",
  outcomeNotice:
    "Prepared means a result was generated. It does not mean applicable, compliant, approved or assessment-ready.",
  viewResult: "View result / history",
  regenerate: "Re-analyze this rule",
  regenerateDescription:
    "Run only this rule with fresh runtime instructions. Previous results remain inspectable.",
  samePins: "Keep previous catalog and source snapshot",
  latestPins: "Explicitly use latest catalog/source inputs",
  current: "Current result",
  latestAttempt: "Latest attempt",
  loadOlder: "Load older results",
  revision: "Result revision",
  compare: "Compare with previous result",
  noResult: "No successful result has been recorded yet.",
  instruction: "Instruction revision / fingerprint",
  sourcePins: "Catalog / source pins",
  runId: "Preparation run ID",
  initiatedBy: "Initiated by",
  timestamp: "Created / completed",
  analysis: "Analysis",
  requirements: "Generated Legal Requirements",
  assessmentRules: "Generated Assessment Rules",
  conditions: "Applicability conditions",
  qualifiers: "Qualifiers",
  exceptions: "Exceptions",
  criteria: "Assessment criteria",
  investigationGoals: "Investigation goals",
  requiredEvidence: "Required evidence",
  unresolvedConditions: "Unresolved conditions",
  nonRepositoryDuty: "Non-repository duty",
  activity: "Run Activity",
  noActivity: "No activity recorded yet.",
  model: "Model",
  tokens: "Tokens",
  stop: "Cancel this rule",
  sourceRead: "Pinned source chunks",
  showInstructions: "Exact instruction content",
  failure: "Failure code",
  close: "Close",
  chooseRevision: "Choose result revision",
  required: "This field is required.",
  invalidCitation: "Enter documentId|locator on each nonempty line.",
  invalidSource: "Enter a valid Legal Source version UUID.",
  state_NOT_PREPARED: "Not yet prepared",
  state_PREPARED: "Prepared",
  state_FAILED: "Failed / interrupted",
  state_RUNNING: "Queued / running",
  state_STALE: "Stale inputs",
  state_INELIGIBLE: "Ineligible",
  reason_SOURCE_UNAVAILABLE:
    "The source version is unavailable or not activated.",
  reason_INDEX_UNAVAILABLE: "Source chunking/index validation is incomplete.",
  reason_CITATION_INVALID:
    "A required citation is missing, invalid or not currently effective.",
  reason_CATALOG_EMPTY: "This catalog has no authored rules.",
  deleteCatalog: "Delete catalog",
  deleteCatalogTitle: "Delete Legal Rule catalog",
  deleteCatalogDescription:
    "Are you sure you want to delete this catalog? All authored rules, selections, and preparation results within this catalog will be permanently deleted. This action cannot be undone.",
  deleteCatalogConfirm: "Delete catalog permanently",
  deleteCatalogSuccess: "Catalog deleted successfully.",
  deleteCatalogConflict:
    "Cannot delete catalog while preparation runs are active or queued.",
  guidance: "Guidance",
  providerLabel: "Provider",
  errorClassLabel: "Error type",
  failureDetailsTitle: "Rule preparation failed",
  failureDetailsHelp: "Detailed failure breakdown for this revision attempt.",
  failureCredentialTitle: "API Authentication / Credential Error",
  failureCredentialDesc:
    "Could not connect or authenticate with the AI model provider. The API key or credentials are missing, invalid, or expired.",
  failureCredentialGuidance:
    "Check provider API key environment configuration on the server or contact system administrator.",
  failureConnectionTitle: "AI Provider Connection Error",
  failureConnectionDesc:
    "The server failed to establish a network connection to the AI provider endpoint within the deadline.",
  failureConnectionGuidance:
    "Check network connectivity or retry analyzing this rule after a brief moment.",
  failureRateLimitTitle: "Rate Limit / Quota Exceeded",
  failureRateLimitDesc:
    "The AI provider account temporarily hit its request rate limit or token quota was exhausted.",
  failureRateLimitGuidance:
    "Please wait a few minutes before retrying, or check provider account quota balance.",
  failureTimeoutTitle: "AI Model Response Timeout",
  failureTimeoutDesc:
    "The AI model did not produce an initial response before the configured deadline.",
  failureTimeoutGuidance:
    "Try regenerating this rule, or adjust model timeout limits in configuration.",
  failureSchemaTitle: "Structured Output Error",
  failureSchemaDesc:
    "The model output did not conform to the expected compliance rule schema or was missing structured content.",
  failureSchemaGuidance:
    "Try regenerating this rule to prompt the model to generate valid schema output.",
  failureBudgetTitle: "Execution Budget Exceeded",
  failureBudgetDesc:
    "The rule preparation process exceeded its allocated model-call or token budget.",
  failureBudgetGuidance:
    "Check agent run budget settings or re-run with fewer iterations.",
  failureSourceTitle: "Legal Source Ineligible",
  failureSourceDesc:
    "The source document is not fully indexed, unavailable, or cited provisions are not effective.",
  failureSourceGuidance:
    "Check legal source indexing status in the Legal Sources module.",
  failureCitationTitle: "Invalid Legal Citation",
  failureCitationDesc:
    "Required citations are missing or do not match indexed source provisions.",
  failureCitationGuidance:
    "Review citations in the rule authoring panel and ensure valid locator references.",
  failureGenericTitle: "Rule Preparation Encountered An Error",
  failureGenericDesc:
    "An error occurred while running the AI model to analyze and extract compliance rules.",
  failureGenericGuidance:
    "Click 'Regenerate this rule' to retry or inspect run activity logs below.",
  importAssessmentRules: "Import Assessment Rules",
  importDialogTitle: "Import Assessment Rules",
  importDialogDescription:
    "Upload one or more Assessment Rule Import v1 documents authored for this catalog. Check them first; nothing is written until you confirm. Imported results are only prepared — activate them separately.",
  importFiles: "Import documents (.json)",
  importNoFiles: "Choose at least one JSON document.",
  importTooManyFiles: "Choose at most 32 documents at a time.",
  importFileInvalidJson: "Not valid JSON.",
  importFileInvalidDocument:
    "Does not match the Assessment Rule Import v1 format.",
  importFileWrongCatalog: "Targets a different catalog than the one selected.",
  importFileStaleRevision:
    "The catalog revision changed after this document was authored. Export again and re-author it.",
  importFileReady: "Ready to check",
  importItems: "Items",
  importExcluded: "Excluded",
  importCheck: "Check (dry run)",
  importChecking: "Checking…",
  importConfirm: "Import",
  importRunning: "Importing…",
  importClose: "Close",
  importCheckPassed: "Check passed. Review the summary, then import.",
  importCheckFailed:
    "The check found problems. Fix the documents and check again.",
  importDone:
    "Import finished. Select the prepared rules and activate them to publish.",
  importWouldRecord: "Would record",
  importRecorded: "Recorded",
  importReplayed: "Unchanged",
  importErrorStale:
    "The catalog or its source changed. Export again and re-author the document.",
  importErrorConflict:
    "A rule in this document is still being prepared. Try again when its run finishes.",
  importErrorInvalid: "The server rejected the document.",
  importIssueOutputInvalid: "Check the document structure and try again.",
  importIssueSourceReferenceInvalid:
    "A cited source does not match the selected Legal Source version.",
  importIssueRequirementLinkInvalid:
    "An Assessment Rule refers to a missing or non-assessable legal requirement.",
  importIssueIdentityInvalid:
    "A rule identifier is duplicated or does not belong to the selected Legal Rule.",
  importIssueApplicabilityInvalid:
    "Review the legal requirement's applicability conditions.",
  importErrorIneligible:
    "A rule in this document is not eligible for preparation.",
  importErrorNotFound: "A rule in this document is not in this catalog.",
  importErrorGeneric: "The import request failed.",
  scopeAuthAction: "Scope Review",
  scopeAuthTitle: "Semantic Scope Authorization",
  scopeAuthDescription:
    "Inspect, approve, or revoke a source-backed semantic scope decision for this Legal Rule.",
  scopeAuthKeyLabel: "Scope Key (64-hex)",
  scopeAuthLoad: "Load Candidate",
  scopeAuthStateLabel: "Review State",
  scopeAuthRevisionLabel: "Revision",
  scopeAuthAuthorLabel: "Submitted By",
  scopeAuthReviewerLabel: "Approved By",
  scopeAuthApproveConfirm:
    "I have independently verified this legal interpretation against the pinned source citations.",
  scopeAuthApproveAction: "Approve Authorization",
  scopeAuthRevokeReasonLabel: "Revocation Reason",
  scopeAuthRevokeConfirm:
    "Confirm revoking this approved authorization for future publications.",
  scopeAuthRevokeAction: "Revoke Authorization",
  scopeAuthError: "Scope authorization action failed.",
  scopeAuthSuccess: "Scope authorization updated.",
} as const;
export type LegalRuleCatalogMessages = {
  [K in keyof typeof enLegalRuleCatalog]: string;
};
