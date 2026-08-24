**CAPSTONE PROJECT REPORT**

# Report 3 – Software Requirement Specification

**Hanoi, August 2026**

## I. Record of Changes

| Date | A* / M / D | In charge | Change Description |
| --- | --- | --- | --- |
| 19/8/26 | A* | Phan N.Q. Minh | Initial Software Requirement Specification. |
| 24/8/26 | M | Phan N.Q. Minh | Updated Report 3 to align with the current LCSP scope and expanded the Use Case catalog into distinct user goals and interactions. |

*A - Added; M - Modified; D - Deleted*

# II. Software Requirement Specification

## 1. Product Overview

LCSP is a web-based platform that supports businesses using artificial intelligence in Vietnam in preparing and reviewing information for legal compliance assessments. The platform brings together business information, relevant software-project information, applicable legal requirements, supporting evidence, assessment findings, and reports in one controlled workspace.

A typical assessment begins when a Manager creates an assessment and provides information about how AI is used in the business. The Manager can then select a connected software repository from Settings and choose the project version to be reviewed. LCSP analyzes the selected project, collects relevant supporting evidence, compares the available information with assessment criteria derived from reviewed legal sources, identifies possible gaps, and prepares results for human review.

LCSP is designed as a compliance-support system. It does not provide legal certification or replace professional legal judgment. When important information is missing or the available evidence is not sufficient, the system must clearly indicate that further clarification or review is required rather than making unsupported assumptions.

## 2. User Requirements

### 2.1 Actors

The system supports a primary business user, optional technical collaboration, internal legal-content maintenance, and external services required for authentication, repository access, and AI-assisted analysis.

| # | Actor | Description |
| --- | --- | --- |
| 1 | Manager | Primary business user who creates assessments, provides business context, selects the project to review, resolves important questions, reviews results, and generates reports. |
| 2 | Developer | Optional technical collaborator who can review assigned technical findings and provide scoped technical input when permitted. |
| 3 | Internal Legal Operator | Internal role responsible for maintaining reviewed legal sources and assessment criteria used by LCSP. |
| 4 | Identity Provider | External authentication service used for approved sign-in flows. |
| 5 | GitHub | External source-code hosting service used to provide read-only access to selected repositories and project versions. |
| 6 | AI Service Provider | External AI service used only for approved assisted-analysis tasks; it must not receive raw source code. |
| 7 | Reviewed Legal Sources | Official or reviewed legal materials used to maintain the legal requirements and citations used in assessments. |

### 2.2 Use Cases

#### 2.2.1 Functional Grouping

The current product scope contains **48 detailed Use Cases**. They are grouped by functional area so the same structure can be used consistently in the SRS, the Project Management WBS, Jira mapping, testing, and project documentation.

| Functional Area | Use Cases |
| --- | --- |
| Account & Authentication | UC-001 to UC-007 |
| Organization & Collaboration | UC-008 to UC-013 |
| Assessment Management | UC-014 to UC-018 |
| Business Context | UC-019 to UC-024 |
| Repository & Project Version | UC-025 to UC-029 |
| Project Analysis & Evidence | UC-030 to UC-035 |
| Conflict & Clarification | UC-036 to UC-038 |
| Legal Requirements | UC-039 to UC-042 |
| Assessment Results | UC-043 to UC-044 |
| Gaps, Reporting & History | UC-045 to UC-048 |

The use cases below describe the current product scope as distinct user goals and interactions. Implementation details remain outside this report.

#### 2.2.2 Descriptions

| ID | Use Case | Actors | Use Case Description |
| --- | --- | --- | --- |
| UC-001 | Sign in with email | Manager / Developer / Internal Legal Operator | Sign in to LCSP with an approved work account and establish an authenticated session. |
| UC-002 | Sign in with identity provider | Manager / Developer / Internal Legal Operator / Identity Provider | Sign in through an approved external identity provider and return to LCSP with a validated identity. |
| UC-003 | Complete MFA verification | Manager / Developer / Internal Legal Operator | Complete the required multi-factor verification step before accessing protected LCSP functions. |
| UC-004 | Manage MFA settings | Manager / Developer / Internal Legal Operator | Set up, update, disable, or recover multi-factor authentication when permitted by account policy. |
| UC-005 | Request password recovery | Manager / Developer / Internal Legal Operator | Request account recovery when the user cannot sign in with the current password. |
| UC-006 | Reset password | Manager / Developer / Internal Legal Operator | Set a new password through an approved recovery process. |
| UC-007 | Sign out | Manager / Developer / Internal Legal Operator | End the current authenticated session and return to the sign-in state. |
| UC-008 | View workspace | Manager / Developer / Internal Legal Operator | View the organization workspace, available navigation, recent work, and items that require attention within the granted scope. |
| UC-009 | View organization members | Manager | Review people who currently have access to the organization and their assigned access. |
| UC-010 | Invite Developer | Manager | Invite a Developer to collaborate on technical review work for the organization. |
| UC-011 | Assign Developer access | Manager | Grant a Developer access to an assessment or technical review task within an approved scope. |
| UC-012 | Update Developer access | Manager | Change the scope of a Developer's existing assessment or technical-review access. |
| UC-013 | Revoke Developer access | Manager | Remove a Developer's access when collaboration is no longer required. |
| UC-014 | View assessment list | Manager / Developer | View assessments available within the user's organization and granted access scope. |
| UC-015 | Search assessments | Manager / Developer | Find an assessment from the assessment list using available search or filtering information. |
| UC-016 | Create assessment | Manager | Create a new compliance assessment under the current organization and record its initial information. |
| UC-017 | Open or continue assessment | Manager / Developer | Open an assessment that the user is allowed to access and continue work from its current state. |
| UC-018 | Update assessment information | Manager | Update the assessment's editable business or project information before later review steps depend on it. |
| UC-019 | Open business-context intake | Manager | Open the guided intake for an assessment and review the information that must be provided. |
| UC-020 | Provide AI use-case information | Manager | Describe the purpose of the AI use case, its business context, and how AI is used in the product or operation. |
| UC-021 | Provide affected-people and data context | Manager | Describe affected people, relevant data, and other business circumstances needed for the assessment. |
| UC-022 | Provide decision-role and human-oversight information | Manager | Describe the role of AI in decisions, the available human oversight, and relevant external AI-service use. |
| UC-023 | Save intake progress | Manager | Save partially completed business-context information and continue the intake later. |
| UC-024 | Review readiness and missing business information | Manager | Review incomplete or uncertain business-context items and understand what must be clarified before later assessment steps. |
| UC-025 | Select connected repository | Manager / Delegated Developer / GitHub | Select a repository already available to the organization as the software project relevant to the assessment. |
| UC-026 | Validate repository access | Manager / Delegated Developer / GitHub | Confirm that LCSP can read the selected repository with the approved read-only access before analysis begins. |
| UC-027 | Select project version | Manager / Delegated Developer / GitHub | Select and record the branch or commit version that will be reviewed for the assessment. |
| UC-028 | Change repository or project version | Manager / Delegated Developer / GitHub | Change the selected repository or reviewed project version when the assessment context requires it. |
| UC-029 | Re-run analysis for a new project version | Manager / GitHub | Start a new analysis for a changed project version while preserving earlier assessment history. |
| UC-030 | Start project analysis | Manager / GitHub / AI Service Provider | Start analysis of the selected project version to collect information relevant to AI use and compliance review. |
| UC-031 | Track analysis progress | Manager / Developer | View the current progress, completion, failure, or retry state of project analysis without blocking the user interface. |
| UC-032 | Review AI-use findings | Manager / Developer | Review identified AI-use information together with supporting evidence, uncertainty, and stated limitations. |
| UC-033 | Review technical evidence | Manager / Developer | Review technical evidence collected from the selected project and understand how it supports an assessment finding. |
| UC-034 | Review missing or insufficient evidence | Manager / Developer | Review items that cannot be confirmed because relevant project information is missing, unclear, or insufficient. |
| UC-035 | Review assigned technical findings | Developer | Review only the technical findings and evidence that have been assigned or made available to the Developer. |
| UC-036 | Review conflicting information | Manager / Developer | Review differences between business-provided information and project evidence without silently replacing either source. |
| UC-037 | Provide requested clarification | Manager / Developer | Provide additional business or technical clarification when an important assessment item cannot yet be confirmed. |
| UC-038 | Confirm assessment profile | Manager | Confirm the reviewed business and project information that will be used as the basis for legal assessment. |
| UC-039 | Review applicable legal requirements | Manager | Review the legal requirements and assessment criteria considered relevant to the confirmed assessment profile. |
| UC-040 | View legal source and citation | Manager / Internal Legal Operator | View the legal source and citation information supporting an assessment criterion or legal conclusion. |
| UC-041 | Maintain reviewed legal sources | Internal Legal Operator | Add, update, review, or retire legal sources used by LCSP while retaining appropriate source and version information. |
| UC-042 | Maintain assessment criteria | Internal Legal Operator | Maintain assessment criteria derived from reviewed legal sources so they can be applied consistently in assessments. |
| UC-043 | Run compliance assessment | Manager | Start evaluation of the available reviewed information against the applicable assessment criteria. |
| UC-044 | Review assessment results | Manager | Review criterion-level findings, supporting evidence, legal basis, possible gaps, and cases where information remains insufficient. |
| UC-045 | Review compliance gaps | Manager | Review requirements that may not yet be satisfied together with the related evidence, criterion, and unresolved information. |
| UC-046 | Generate assessment report | Manager | Generate an assessment report containing assessment context, reviewed evidence, legal requirements, gaps, limitations, and review items. |
| UC-047 | View or download generated report | Manager | Open an available assessment report and download it when the supported report format is available. |
| UC-048 | Review assessment activity and prior versions | Manager | Review important assessment actions, project versions, analysis runs, review decisions, and previously generated reports. |

## 3. Functional Requirements

### 3.1 System Functional Overview

LCSP organizes the assessment process around a workspace, individual assessments, business-context collection, repository selection, technical evidence review, assessment results, reporting, and traceability. The system must keep the user informed about missing information, unavailable evidence, access limitations, and the next action required to continue an assessment.

#### 3.1.1 Screens Flow

The main user flow covers authentication, workspace access, assessment creation, business-context collection, repository and project-version selection, project analysis, evidence review, conflict clarification, assessment results, gap review, reporting, and activity history. Developer participation remains limited to granted technical-review scope.

> The previous repository use-case diagram was based on the superseded 17-use-case catalog. The current canonical use-case grouping is defined in §2.2 and in `likec4/usecases.c4` on the same documentation branch.

#### 3.1.2 Screen Descriptions

| # | Feature | Screen | Description |
| --- | --- | --- | --- |
| 1 | Account | Sign In / MFA | Authenticate users and complete required account verification before workspace access. |
| 2 | Workspace | Workspace Overview | Show organization context, recent assessments, work requiring attention, and main navigation. |
| 3 | Assessment | Assessments | List assessments, support search, and open an assessment for continued review. |
| 4 | Assessment | Create Assessment | Create a new assessment and record its basic context. |
| 5 | Business Context | Intake Wizard | Collect and save business-language information about AI use and affected context. |
| 6 | Business Context | Readiness | Show missing or incomplete information and the next actions required before later review steps. |
| 7 | Repository | Settings / Repository Selection | Select the repository and project version used by an assessment from repositories already available to the organization. |
| 8 | Evidence | Technical Evidence | Show project-analysis progress, technical findings, supporting evidence, and limitations. |
| 9 | Review | Conflict Review | Present conflicting or unclear information that requires Manager review. |
| 10 | Assessment | Classification / Assessment Result | Present assessment findings, supporting criteria, citations, and unresolved limitations. |
| 11 | Reporting | Documents | Show generated reports and available downloads for the assessment. |
| 12 | Collaboration | Developers | Manage optional Developer participation and scoped access. |
| 13 | Collaboration | Technical Findings | Allow an authorized Developer to review only the technical findings assigned or permitted to them. |

#### 3.1.3 Screen Authorization

Access is controlled by organization scope and assigned permissions. The table below shows intended user-level access; detailed authorization rules remain enforced by the system.

| Screen | Manager | Developer | Internal Legal Operator |
| --- | --- | --- | --- |
| Sign In / MFA | X | X | X |
| Workspace Overview | X | Limited | Limited |
| Assessments | X | Assigned only | — |
| Create Assessment | X | — | — |
| Intake Wizard | X | — | — |
| Readiness | X | — | — |
| Settings / Repository Selection | X | Delegated only | — |
| Technical Evidence | X | Redacted / assigned | — |
| Conflict Review | X | Limited input | — |
| Classification / Assessment Result | X | — | — |
| Documents | X | — | — |
| Developers | X | — | — |
| Technical Findings | X | X | — |

#### 3.1.4 Non-Screen Functions

The following functions run in the background or provide supporting services without requiring a dedicated user screen.

| # | Feature | System Function | Description |
| --- | --- | --- | --- |
| 1 | Project Analysis | Analyze selected project | Review the selected project version and identify information relevant to AI use and assessment. |
| 2 | Evidence | Prepare supporting evidence | Organize relevant project information into reviewable evidence while protecting sensitive source information. |
| 3 | Assessment Support | Identify missing information | Detect important information that cannot be confirmed and request additional clarification when needed. |
| 4 | Legal Review | Match assessment criteria | Compare confirmed assessment information with applicable criteria derived from reviewed legal sources. |
| 5 | Assessment | Evaluate criteria | Determine whether available information supports a requirement, indicates a possible gap, or remains insufficient. |
| 6 | Reporting | Prepare gaps and report | Summarize assessment findings, gaps, evidence, limitations, and report content. |
| 7 | Traceability & Security | Maintain history and safeguards | Record important actions and versions while applying access, privacy, and security controls. |

#### 3.1.5 Entity Relationship Overview

The following list presents the main business entities at SRS level. Detailed database design belongs to Report 4.

| # | Entity | Description |
| --- | --- | --- |
| 1 | Organization | Represents the business workspace that owns users, assessments, and access boundaries. |
| 2 | User / Membership | Represents a user and their organization membership or permitted access. |
| 3 | Assessment | Represents one compliance assessment and its overall review context and history. |
| 4 | Business Context | Stores information provided by the Manager about AI use and business circumstances. |
| 5 | Repository Connection | Represents approved read-only access to a software repository. |
| 6 | Project Snapshot | Records the exact project version reviewed by an assessment. |
| 7 | Evidence | Stores supporting information gathered or accepted for assessment review without retaining unnecessary raw source content. |
| 8 | AI-Use Finding | Represents identified information about how AI appears to be used in the reviewed project and business context. |
| 9 | Assessment Profile | Represents the reviewed set of information used as the basis for legal assessment. |
| 10 | Legal Source | Represents a reviewed legal document or source used by LCSP. |
| 11 | Assessment Criterion | Represents a requirement derived from a reviewed legal source for consistent assessment. |
| 12 | Assessment Result | Represents the finding for an assessment criterion together with supporting information and limitations. |
| 13 | Gap Finding | Represents a possible compliance gap or unresolved issue identified from assessment results. |
| 14 | Report | Represents a generated assessment report and the assessment/project version used to create it. |
| 15 | Audit Record | Represents an important recorded action or change used for later review and traceability. |

### 3.2 Assessment Setup & Business Context

#### 3.2.1 Create and Manage Assessment

- **Function trigger:** A Manager selects Create Assessment from the workspace or assessment list.
- **Function description:** The system creates an assessment under the current organization and records its basic information, owner, creation time, and review context.
- **Function details:** The assessment must remain within the current organization boundary. Required information must be validated before the assessment is created. The Manager can reopen an existing assessment to continue incomplete work.

#### 3.2.2 Provide Business and AI-Use Information

- **Function trigger:** A Manager opens the Intake Wizard for an assessment.
- **Function description:** The system collects business-language information about the AI use case, affected users, data involved, decision role, human oversight, and other context needed for assessment.
- **Function details:** The Manager can save progress and continue later. Questions must use understandable business language. If the Manager is unsure about an item, the system should allow the uncertainty to be recorded and show what information is still needed. Business-context information alone must not be presented as a final legal conclusion.

### 3.3 Repository & Project Analysis

#### 3.3.1 Select Repository and Project Version

- **Function trigger:** A Manager opens Settings for the assessment and selects a repository that has already been connected to LCSP.
- **Function description:** The system lists repositories available to the organization, allows the Manager to select the repository relevant to the assessment, and records the project version that will be reviewed.
- **Function details:** Repository access must be read-only. The selected project version must be recorded so that later findings and reports can be traced to the correct source. If access is unavailable, the system must explain the problem and prevent analysis from starting until it is resolved.

#### 3.3.2 Run Project Analysis

- **Function trigger:** The Manager starts analysis after a valid repository and project version have been selected, or the system starts the approved analysis process when the assessment is ready.
- **Function description:** LCSP reviews the selected software project to identify information related to AI usage and collect supporting evidence relevant to the assessment.
- **Function details:** The system must not execute the customer application during analysis. Sensitive information must be protected, and raw source code must not be sent to an external AI service. Long-running analysis must provide visible progress or status information instead of blocking the user interface.

#### 3.3.3 Review Evidence and Missing Information

- **Function trigger:** Analysis has produced findings or identified information that cannot be confirmed.
- **Function description:** The Manager reviews the technical evidence, AI-use findings, limitations, and items that require additional information.
- **Function details:** Each important finding should be connected to its supporting project information where appropriate. Missing or unclear information must remain explicit. The system must not convert insufficient evidence into a confirmed conclusion.

### 3.4 Legal Review & Assessment

#### 3.4.1 Review Applicable Legal Requirements

- **Function trigger:** Sufficient assessment information is available for legal review.
- **Function description:** The system identifies relevant assessment criteria from reviewed legal sources and presents the legal basis used for the assessment.
- **Function details:** Important assessment conclusions must be traceable to the relevant legal source and criterion. If a required legal source or citation is unavailable, the affected conclusion must be withheld or marked as requiring further review.

#### 3.4.2 Resolve Conflicting or Missing Information

- **Function trigger:** Business information and project evidence conflict, or an important assessment item remains unclear.
- **Function description:** The Manager reviews the conflicting information, supporting evidence, and requested clarification before confirming how the assessment should proceed.
- **Function details:** Existing evidence must remain visible and must not be silently replaced. Important unresolved conflicts can prevent a final assessment result until a Manager reviews them.

#### 3.4.3 Run Assessment and Review Results

- **Function trigger:** Required business information, project evidence, and legal criteria are available for the assessment step.
- **Function description:** LCSP evaluates the available information against the applicable assessment criteria and presents the resulting findings for human review.
- **Function details:** Results must distinguish between supported findings, possible gaps, and cases where the available information is insufficient. The system must not present its output as legal certification or a substitute for professional legal advice.

### 3.5 Gap Analysis, Reporting & Traceability

#### 3.5.1 Review Compliance Gaps

- **Function trigger:** Assessment results are available.
- **Function description:** The system summarizes requirements that may not yet be satisfied, the evidence considered, and unresolved items that need attention.
- **Function details:** Gap items should be understandable to a business user and should reference the related assessment criterion and supporting information where available.

#### 3.5.2 Generate Assessment Report

- **Function trigger:** The Manager requests a report after the required assessment steps have been completed.
- **Function description:** LCSP prepares a report containing assessment context, reviewed evidence, relevant legal requirements, identified gaps, limitations, and items requiring human review.
- **Function details:** Reports must preserve the project version and assessment information used to produce them. The report must clearly state the product boundary and must not claim legal certification.

#### 3.5.3 Review Activity History

- **Function trigger:** The Manager opens the assessment history or review history.
- **Function description:** The system shows important actions and changes related to the assessment, including project-version changes, analysis runs, review actions, and generated reports.
- **Function details:** The history should support later review without exposing unnecessary sensitive information. New analysis runs must not silently overwrite the history of earlier runs.

## 4. Non-Functional Requirements

### 4.1 External Interfaces

| # | External Interface | Requirement |
| --- | --- | --- |
| 1 | Web Browser | LCSP must provide a responsive web interface for supported assessment and review workflows. |
| 2 | Identity Provider | Authentication integration must validate approved sign-in flows without granting repository access automatically. |
| 3 | GitHub | Repository integration must be read-only, limited to selected repositories, and able to identify the project version reviewed. |
| 4 | AI Service Provider | AI-assisted analysis may receive only approved, minimized assessment information and must not receive raw source code. |
| 5 | Reviewed Legal Sources | Legal content used in assessment must come from reviewed sources and preserve enough citation/version information for traceability. |

### 4.2 Quality Attributes

#### 4.2.1 Usability

Manager-facing content must use clear business language and avoid unexplained implementation terminology. Forms should provide understandable validation messages, and blocked or incomplete steps should explain the reason and the next action available to the user. Common accessibility expectations for keyboard navigation, labels, and status messages should be followed.

#### 4.2.2 Reliability

Long-running analysis and report-generation work must retain its progress and failure information independently of a single browser request. When critical evidence, legal support, or required review information is missing, LCSP must not produce an unsupported final conclusion. Re-running an assessment must preserve prior review history rather than silently replacing it.

#### 4.2.3 Performance

Interactive screens should provide prompt feedback for normal user actions. Operations that require extended processing must run without freezing the user interface and must expose progress, completion, failure, or retry information. Analysis work must operate within defined resource and time limits.

#### 4.2.4 Security & Privacy

Workspace access must be restricted to the correct organization and granted scope. Repository access must be read-only and limited to repositories selected for LCSP. Raw source code must not be sent to an external AI provider or stored as long-term assessment data. Secrets and other sensitive information must be removed from logs, evidence summaries, reports, and AI-assisted processing where applicable.

#### 4.2.5 Traceability & Auditability

Important assessment findings must remain traceable to the relevant assessment, project version, supporting evidence, legal criterion, and report version. Material actions must be recorded so that the assessment can be reviewed later without relying on memory or an AI-generated explanation alone.

#### 4.2.6 Maintainability

Requirements, implementation, tests, and project documents should remain aligned through agreed identifiers and review practices. Major changes to assessment behavior, legal criteria, evidence handling, or security controls should be documented before release.

## 5. Requirement Appendix

### 5.1 Business Rules

The following rules summarize the business constraints that most directly affect the current assessment workflow. The detailed rule catalog remains maintained with the project requirements.

| ID | Rule Definition |
| --- | --- |
| BR-018 | A Manager is accountable for an assessment's business and review decisions within the access granted by the organization. |
| BR-023 | After an assessment is created, the Manager may continue with business-context collection or repository selection; the assessment does not depend on one mandatory path. |
| BR-026 | When business context is collected, it must cover the AI purpose, sector, data involved, affected people, decision role, human oversight, and external AI-service use where relevant. |
| BR-027 | Business-context questions must use business-readable language rather than source-code terminology. |
| BR-032 | The current technical-evidence path uses read-only analysis of a selected GitHub repository and recorded project version. |
| BR-041 | When business information conflicts with project evidence, the difference must remain visible and be reviewed instead of silently choosing one source. |
| BR-049 | A final assessment result may be produced only after the required reviewed information and legal assessment inputs are available. |
| BR-050 | Important legal conclusions must be traceable to the related legal source and citation information. |
| BR-051 | If critical legal support is missing, LCSP must not invent or present an unsupported final conclusion. |
| BR-057 | Raw source code must not be sent to an external AI service. |

### 5.2 Common Requirements

| ID | Common Requirement |
| --- | --- |
| CR-01 | All user-facing assessment content should use clear business language and explain technical terms when they are necessary. |
| CR-02 | Each assessment must remain within the correct organization and access scope. |
| CR-03 | Missing or uncertain information must be shown explicitly rather than guessed. |
| CR-04 | Repository analysis must be read-only and related findings must remain linked to the reviewed project version. |
| CR-05 | Sensitive source information, credentials, and secrets must not be exposed unnecessarily in screens, logs, reports, or AI-assisted processing. |
| CR-06 | Assessment findings must remain reviewable together with supporting evidence and applicable legal criteria. |
| CR-07 | Generated reports must state important limitations and must not claim legal certification. |
| CR-08 | Important actions, assessment versions, and generated reports must be recorded so later review can reconstruct what was assessed. |

### 5.3 Application Messages List

The following list contains representative messages already used or required by the current user flows. Final wording may be refined together with UI review while preserving the same meaning.

| # | Message Code | Message Type | Context | Content |
| --- | --- | --- | --- | --- |
| 1 | MSG-001 | Inline | Assessment search has no matches | No matching assessments found. |
| 2 | MSG-002 | Inline validation | Sign-in email is empty | Enter your work email. |
| 3 | MSG-003 | Inline validation | Sign-in email format is invalid | Enter a valid work email. |
| 4 | MSG-004 | Alert / toast | Sign-in request fails | Unable to sign in. Please try again. |
| 5 | MSG-005 | Inline | No assessment is selected | Please select your assessment first. |
| 6 | MSG-006 | Empty state | Technical findings are not available yet | No technical findings available yet for this assessment. |
| 7 | MSG-007 | Alert | Developer task access has been revoked | Your access to this task was revoked. |
| 8 | MSG-008 | Loading state | Assessment list is being retrieved | Loading assessments. |
| 9 | MSG-009 | Alert / toast | Security settings cannot be saved | Security settings could not be updated right now. Please try again. |
| 10 | MSG-010 | Confirmation | Password recovery request is accepted | Request received. If the email exists in the system, recovery instructions will be sent through the appropriate channel. |

### 5.4 Other Requirements

Detailed screen mockups, final field-level validation specifications, and complete requirement-to-test traceability will continue to be updated in later Capstone milestones together with implementation and testing evidence.
