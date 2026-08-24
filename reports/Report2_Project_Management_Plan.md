**CAPSTONE PROJECT REPORT**

# Report 2 – Project Management Plan

**Hanoi, August 2026**

## I. Record of Changes

| Date | A* / M / D | In charge | Change Description |
| --- | --- | --- | --- |
| 19/8/26 | A* | Phan N.Q. Minh | Initial Project Management Plan. |
| 24/8/26 | M | Phan N.Q. Minh | Updated the Scope & Estimation WBS so functional areas and child work items align with Report 3 Use Cases and the current Jira backlog, while retaining the six-week calibrated effort baseline. |

*A - Added; M - Modified; D - Deleted*

# II. Project Management Plan

## 1. Overview

### 1.1 Scope & Estimation

The WBS is organized by the functional areas defined in Report 3, and each child work item uses the corresponding Use Case name so scope can be traced consistently across project documents. Completed Jira work items and merged GitHub pull requests are used to confirm implementation scope and calibrate relative effort. Jira modules may group several use cases for engineering purposes, so module names are not used as WBS titles when they do not match the SRS structure.

The effort values remain calibrated to the six-week period from **10 July to 24 August 2026** and are planning estimates rather than recorded actual effort because detailed worklogs and original estimates are not available in Jira.

| # | WBS Item | Complexity | Est. Effort (man-days) |
| --- | --- | --- | ---: |
| **1** | **Account & Authentication** |  | **13** |
| 1.1 | Sign in with email | Medium | 2 |
| 1.2 | Sign in with identity provider | Medium | 2 |
| 1.3 | Complete MFA verification | Medium | 2 |
| 1.4 | Manage MFA settings | Medium | 3 |
| 1.5 | Request password recovery | Simple | 1 |
| 1.6 | Reset password | Medium | 2 |
| 1.7 | Sign out | Simple | 1 |
| **2** | **Organization & Collaboration** |  | **10** |
| 2.1 | View workspace | Medium | 2 |
| 2.2 | View organization members | Simple | 1 |
| 2.3 | Invite Developer | Medium | 2 |
| 2.4 | Assign Developer access | Medium | 2 |
| 2.5 | Update Developer access | Medium | 2 |
| 2.6 | Revoke Developer access | Simple | 1 |
| **3** | **Assessment Management** |  | **10** |
| 3.1 | View assessment list | Simple | 1 |
| 3.2 | Search assessments | Simple | 1 |
| 3.3 | Create assessment | Medium | 3 |
| 3.4 | Open or continue assessment | Medium | 2 |
| 3.5 | Update assessment information | Medium | 3 |
| **4** | **Business Context** |  | **12** |
| 4.1 | Open business-context intake | Simple | 1 |
| 4.2 | Provide AI use-case information | Medium | 2 |
| 4.3 | Provide affected-people and data context | Medium | 2 |
| 4.4 | Provide decision-role and human-oversight information | Complex | 3 |
| 4.5 | Save intake progress | Simple | 1 |
| 4.6 | Review readiness and missing business information | Medium | 3 |
| **5** | **Repository & Project Version** |  | **10** |
| 5.1 | Select connected repository | Medium | 2 |
| 5.2 | Validate repository access | Medium | 2 |
| 5.3 | Select project version | Medium | 2 |
| 5.4 | Change repository or project version | Medium | 2 |
| 5.5 | Re-run analysis for a new project version | Medium | 2 |
| **6** | **Project Analysis & Evidence** |  | **18** |
| 6.1 | Start project analysis | Complex | 5 |
| 6.2 | Track analysis progress | Simple | 2 |
| 6.3 | Review AI-use findings | Medium | 3 |
| 6.4 | Review technical evidence | Medium | 3 |
| 6.5 | Review missing or insufficient evidence | Medium | 3 |
| 6.6 | Review assigned technical findings | Medium | 2 |
| **7** | **Conflict & Clarification** |  | **7** |
| 7.1 | Review conflicting information | Medium | 3 |
| 7.2 | Provide requested clarification | Medium | 2 |
| 7.3 | Confirm assessment profile | Medium | 2 |
| **8** | **Legal Requirements** |  | **8** |
| 8.1 | Review applicable legal requirements | Medium | 2 |
| 8.2 | View legal source and citation | Simple | 1 |
| 8.3 | Maintain reviewed legal sources | Medium | 2 |
| 8.4 | Maintain assessment criteria | Complex | 3 |
| **9** | **Assessment Results** |  | **6** |
| 9.1 | Run compliance assessment | Complex | 3 |
| 9.2 | Review assessment results | Medium | 3 |
| **10** | **Gaps, Reporting & History** |  | **6** |
| 10.1 | Review compliance gaps | Medium | 2 |
| 10.2 | Generate assessment report | Complex | 2 |
| 10.3 | View or download generated report | Simple | 1 |
| 10.4 | Review assessment activity and prior versions | Simple | 1 |
|  | **Total Calibrated Effort (man-days)** |  | **100** |

### 1.2 Project Objectives

The project objective is to deliver a usable web-based platform that supports businesses using AI in Vietnam in preparing and reviewing information for legal compliance assessments. The team aims to deliver the agreed scope within the Capstone semester, maintain traceability between requirements, implementation, tests, and project documents, and keep important assessment findings reviewable by human stakeholders. The following values are planning targets used to manage quality, schedule, and effort.

#### Quality Targets

| # | Testing Stage | Test Coverage | No. of Defects | % of Defect | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Reviewing | 100% pull requests | N/A | N/A | All implementation changes reviewed before merge |
| 2 | Unit Test | At least 80% for applicable core logic | 0 Critical | 0% Critical | Automated tests for applicable core business logic |
| 3 | Integration Test | 100% critical integration scenarios | 0 Critical | 0% Critical | Critical internal and external integration scenarios |
| 4 | System Test | 100% major user workflows | 0 Critical | 0% Critical | End-to-end verification of major user workflows |
| 5 | Acceptance Test | 100% agreed core acceptance criteria | 0 Blocking | 0% Blocking | Major acceptance issues resolved or formally accepted |

- **Milestone Timeliness Target:** at least 90%
- **Calibrated Effort Baseline:** 100 man-days for 10 July–24 August 2026

### 1.3 Project Risks

The team tracks risks that may affect project scope, schedule, quality, security, or the reliability of assessment results. Risks are reviewed during project planning and when significant changes occur.

| # | Risk Description | Impact | Possibility | Response Plans |
| --- | --- | --- | --- | --- |
| 1 | Legal or regulatory interpretation is unclear or changes during the project | High | Medium | Maintain traceable legal sources, record assumptions, and seek supervisor or domain review for unclear cases. |
| 2 | Incomplete business or project information | High | High | Identify missing information early, request clarification, and avoid unsupported assumptions. |
| 3 | AI-assisted analysis produces inaccurate or inconsistent suggestions | High | Medium | Keep supporting evidence visible, require review for important conclusions, and test representative cases. |
| 4 | Repository access or integration becomes unavailable | Medium | Medium | Validate access early, track connection issues, and define a fallback handling process when a connection is unavailable. |
| 5 | Large repositories or processing constraints affect assessment time | Medium | Medium | Review processing scope, monitor execution, and optimize high-cost analysis paths. |
| 6 | Scope growth or frequent backlog changes | High | High | Prioritize core scope, review changes against milestones, and defer lower-priority work when necessary. |
| 7 | Knowledge gaps across legal, AI, and web-development areas | Medium | Medium | Use targeted training, peer review, and shared technical or domain notes. |
| 8 | Exposure of source code, credentials, or confidential information | High | Medium | Apply least-privilege access, avoid storing secrets, and review handling of sensitive project data. |

## 2. Management Approach

The team uses an iterative delivery approach. Work is organized in Jira, implementation changes are managed in GitHub, and formal project documents are maintained in Google Drive. At the beginning of each iteration, the team reviews priorities and expected outcomes. During implementation, members update their work, raise blockers early, and use pull requests for review. Completed work is tested and demonstrated before related documents and backlog items are updated.

### 2.1 Project Process

The project follows an iterative delivery process with six recurring activities:

1. **Planning and prioritization:** review the backlog, milestone goals, and current risks.
2. **Requirement clarification and design:** confirm expected behavior and identify information needed before implementation.
3. **Implementation:** complete assigned work in small, reviewable changes.
4. **Review and testing:** review code, verify functionality, and record defects or follow-up work.
5. **Demonstration and feedback:** present completed work and collect feedback from the team and supervisor when applicable.
6. **Documentation and backlog update:** update project documents, Jira tasks, and supporting information to reflect the delivered work.

### 2.2 Quality Management

Project quality is managed throughout each iteration rather than only at the final testing stage.

- **Defect prevention:** clarify requirements and acceptance expectations before implementation, keep changes small enough to review, and follow agreed coding practices.
- **Code review:** implementation changes are reviewed through pull requests before they are merged.
- **Automated checks:** linting, type checking, and automated tests are used where applicable to detect issues early.
- **Functional testing:** important user workflows and system integrations are tested before milestone demonstrations and releases.
- **Defect management:** defects are recorded and prioritized according to their impact, with critical issues addressed before release readiness.
- **Release readiness:** required tests, reviews, project documents, and backlog updates are checked before each major milestone.

### 2.3 Training Plan

Training is planned only where the project requires additional knowledge or a common working practice across the team. The focus is on project domain knowledge, the current development stack, testing, collaboration, and secure handling of project information.

| Training Area | Participants | When, Duration | Waiver Criteria |
| --- | --- | --- | --- |
| Project domain and Vietnam AI compliance context | All team members | At project start; refresh when scope changes | Waived only with demonstrated project-domain understanding |
| Git and GitHub pull-request workflow | All team members | Onboarding; one session plus practice | Waived for members already contributing through the project workflow |
| Web application stack | Members working on web or API tasks | Early development; targeted sessions as needed | Waived based on demonstrated contribution |
| Python analysis services | Members working on analysis tasks | Before related implementation; targeted sessions | Waived based on demonstrated contribution |
| Testing and quality practices | All team members | Before first implementation milestone; refresh before system testing | Waived with demonstrated testing and review skills |
| Security and privacy handling | All team members | Before handling connected repositories or sensitive project data | Mandatory |

## 3. Project Deliverables

The project deliverables follow the Capstone milestone structure. Each milestone includes the required report or software package together with updated supporting documents and project tracking.

| # | Deliverable | Due Date | Notes |
| --- | --- | --- | --- |
| 1 | Project Introduction Document | End of Week 1 | Report 1 |
| 2 | Project Management Plan | End of Week 2 | Report 2 |
| 3 | Overall Requirement Description | End of Week 3 | Report 3 and updated Reports 1–2 |
| 4 | Overall Software Design Description | End of Week 5 | Report 4, initial testing documentation, and demo code package |
| 5 | Software Package 1 | End of Week 7 | Working implementation and updated requirements, design, and test documents |
| 6 | Software Package 2 | End of Week 9 | Second implementation iteration and updated documentation |
| 7 | Software Package 3 | End of Week 11 | Third implementation iteration and updated documentation |
| 8 | Full Software Package | End of Week 13 | Full implementation for system testing and updated project documents |
| 9 | User Guides | End of Week 14 | Report 6 and updated project tracking |
| 10 | Final Package | End of Week 15 | Final report, project products, and defense slides |

## 4. Responsibility Assignments

The following matrix assigns shared project responsibilities without assuming fixed technical specializations. Individual task ownership is maintained in Jira and may change during the project as workload and priorities change.

*D = Do; R = Review; S = Support; I = Informed; blank = Omitted*

| Responsibility | Phan N.Q. Minh | Le Bao Nhi | Nguyen Anh Tu | Nguyen Tuan Anh | Tran N.D. Thuy |
| --- | --- | --- | --- | --- | --- |
| Project planning & tracking | D | S | S | S | S |
| Backlog & requirement review | R | D | D | D | D |
| Implementation & integration | D | D | D | D | D |
| Pull request review | R | R | R | R | R |
| Testing & defect handling | R | D | D | D | D |
| Project documentation | R | D | D | D | D |
| Milestone preparation & submission | D | S | S | S | S |

## 5. Project Communications

| Communication Item | Who / Target | Purpose | When, Frequency | Type, Tool, Method(s) |
| --- | --- | --- | --- | --- |
| Weekly team meeting | Project team | Review progress, blockers, and priorities | Weekly | Discord; Jira |
| Supervisor progress meeting | Supervisor and project team | Report progress, receive feedback, resolve major issues | As scheduled | Direct or online meeting; Google Docs; Jira |
| Backlog and task updates | Project team | Keep task ownership, progress, and priorities current | Whenever work changes; reviewed weekly | Jira |
| Code review | Members involved in the change | Review implementation quality and change impact | For each pull request | GitHub Pull Request |
| Document review | Project team; supervisor when required | Review formal deliverables before submission | Before each report milestone | Google Docs; Google Drive |
| Urgent issue coordination | Affected team members | Resolve blocking or high-impact issues | As needed | Team communication; Jira update |

## 6. Configuration Management

### 6.1 Document Management

Formal Capstone documents are maintained in Google Drive and edited collaboratively in Google Docs. Major report changes are recorded in the Record of Changes section. Technical supporting documents that belong closely to the source code are maintained as Markdown files in the GitHub repository. Before each milestone submission, the team reviews document completeness and consistency with the current project scope, backlog, and implemented features.

### 6.2 Source Code Management

Source code is managed in GitHub using Git. Changes are developed on separate branches and merged through pull requests after review and required project checks. Pull requests should reference related Jira work when practical and contain a clear description of the change. The main branch is treated as the integration baseline. Before each milestone release, the team verifies that required checks and tests pass and that related tasks and documentation are updated.

### 6.3 Tools & Infrastructures

| Category | Tools / Infrastructure |
| --- | --- |
| Application development | Next.js, React, TypeScript; NestJS, Node.js, TypeScript; Python |
| Database & data access | PostgreSQL, Prisma |
| Package & build | pnpm, Turborepo |
| Testing & quality | Project test suites, linting, type checking |
| Documentation | Google Docs, Google Drive, Markdown documentation |
| Version control | Git |
| Repository hosting & code review | GitHub, Pull Requests |
| Project management | Jira |
