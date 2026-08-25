CAPSTONE PROJECT REPORT
Report 1 – Project Introduction

– Da Nang, August 2026 –
Table of Contents
I. Record of Changes 3
II. Project Introduction 4

1. Overview 4
   1.1 Project Information 4
   1.2 Project Team 4
2. Product Background 4
   3.1 Holistic AI 5
   3.1.1 System Overview 5
   3.1.2 Functional Approach 5
   3.1.3 Evaluation and Relevance to LCSP 5
   3.2 Credo AI 5
   3.2.1 System Overview 5
   3.2.2 Functional Approach 5
   3.2.3 Evaluation and Relevance to LCSP 6
   3.3 IBM watsonx.governance 6
   3.3.1 System Overview 6
   3.3.2 Functional Approach 6
   3.3.3 Evaluation and Relevance to LCSP 6
   3.4 Saidot 6
   3.4.1 System Overview 6
   3.4.2 Functional Approach 6
   3.4.3 Evaluation and Relevance to LCSP 7
3. Business Opportunity 7
4. Software Product Vision 7
5. Project Scope & Limitations 8
   6.1 Major Features 8
   6.2 Limitations & Exclusions 10

I. Record of Changes
Date
A*
M, D
In charge
Change Description
20/07/2026
A
Lê Bảo Nhi
Added the initial Project Introduction for the LCSP project based on the approved product, requirement, architecture, and implementation documents
24/08/2026
M
Phan Nguyễn Quốc Minh
Updated the Project Introduction to reflect the current LCSP product scope and assessment workflow.
24/8/2026
M
Phan Nguyễn Quốc Minh
Revised Product Background to reflect the current evidence-driven architecture using Program Evidence Graph, EngineeringRules, agent-assisted investigation, deterministic evaluation, and human-in-the-loop checkpoints.
24/8/2026
M
Lê Bảo Nhi
Completed Existing Systems with benchmark analysis of Holistic AI, Credo AI, IBM watsonx.governance, and Saidot.
24/8/2026
M
Phan Nguyễn Quốc Minh
Revised Business Opportunity to clarify the need to connect declared business context, legal requirements, and verifiable technical evidence.
24/8/2026
M
Phan Nguyễn Quốc Minh
Revised Software Product Vision to reflect the current flow from business context collection and legal rule selection to technical investigation, evidence evaluation, gap analysis, reporting, and audit.
24/8/2026
A
Lê Bảo Nhi
Added Current Product Scope and updated Major Features to reflect the Adaptive Context Wizard, Git-provider access, commit-pinned repository snapshots, single-repository Program Evidence Graph, EngineeringRules, Deep-Agent investigation, deterministic evaluation, human-in-the-loop checkpoints, scheduled workflows, governed external tools, repository knowledge, and context engineering.
24/8/2026
M
Phan Nguyễn Quốc Minh
Revised Limitations and Exclusions to align with the current LCSP product boundary and controlled evidence-assessment approach.

*A - Added M - Modified D - Deleted

II. Project Introduction

1. Overview
   1.1 Project Information
   Project name: Legal Compliance Support Platform
   Project code: SEP490
   Group name: SE_30
   Software type: Web App
   1.2 Project Team
   Full Name
   Role
   Email
   Mobile
   Nguyen Phuong Tam
   Lecturer
   tamnp4@fe.edu.vn
   0904692410
   Phan Nguyen Quoc Minh
   Leader
   minhpnqde180979@fpt.edu.vn
   0767348675
   Le Bao Nhi
   Member
   lebaonhi0805@gmail.com
   0834437473
   Nguyen Anh Tu
   Member
   anhtunguyen643@gmail.com
   0912252316
   Nguyen Tuan Anh
   Member
   anhntde180721@fpt.edu.vn
   0392708162
   Tran Nguyen Dang Thuy
   Member
   trannguyendangthuy120701@gmail.com
   0969559757

2. Product Background
   Artificial intelligence is increasingly used in software products and business processes, while governments and regulatory authorities are introducing requirements to ensure that AI systems are developed and used responsibly and in accordance with applicable laws. As a result, organizations that develop or operate AI-enabled software need to understand how AI is used within their systems, which requirements may apply, and whether they have sufficient information and evidence to support compliance assessment. In practice, this process can be difficult because the necessary information is often distributed across different roles and sources: business users understand the purpose and impact of the system, technical teams understand how it is implemented, and compliance or legal personnel interpret the relevant requirements. When these perspectives are assessed separately or rely mainly on questionnaires and manually collected information, the resulting assessment may be incomplete, inconsistent, or difficult to verify against the actual system. LCSP was proposed to address this need by providing a more structured and traceable way to connect business context, applicable requirements, and technical evidence, helping organizations evaluate their compliance readiness based on both declared information and verifiable implementation evidence.
3. Existing Systems
   Several existing AI governance platforms were reviewed to understand how current solutions support organizations in managing AI risks, regulatory requirements, evidence, and compliance activities. Although these systems have different scopes and approaches, they provide useful references for defining the workflow and features of LCSP.
   3.1 Holistic AI
   3.1.1 System Overview
   Holistic AI is an enterprise AI governance platform that helps organizations discover, assess, monitor, and manage AI systems. It is mainly used by governance, compliance, risk, business, and technical teams responsible for managing AI systems across an organization.
   3.1.2 Functional Approach
   Holistic AI first helps organizations identify AI systems from different sources, including cloud services and source-code repositories. These systems are then assessed for risks and compliance requirements, while technical testing and evidence collection are used to support the assessment. The platform also provides controls, review workflows, remediation tracking, and continuous monitoring after the initial assessment. The general flow can be understood as: AI Discovery -> Risk Assessment -> Technical Testing -> Controls and Evidence -> Review -> Continuous Monitoring
   3.1.3 Evaluation and Relevance to LCSP
   Holistic AI is a useful reference because it shows that AI governance should combine business information with technical evidence rather than rely only on questionnaires. It also demonstrates the value of continuous evidence collection and traceability. However, its scope is broad and focuses on enterprise-wide AI governance, while LCSP focuses more specifically on investigating technical evidence from a selected software repository against applicable requirements.
   3.2 Credo AI
   3.2.1 System Overview
   Credo AI is an AI governance platform that helps organizations manage AI systems, risks, policies, controls, and regulatory requirements throughout the AI lifecycle. Its users include governance, legal, compliance, product, business, and engineering teams.  
   3.2.2 Functional Approach
   Credo AI begins by registering AI systems and collecting information about their business use and technical characteristics. Based on this context, relevant policies, risks, and controls can be identified. Evidence from enterprise and development systems can then be connected to these controls, while review and approval workflows are used to support governance decisions. The platform also supports monitoring so that assessments can be updated when the AI system changes. The general flow is: Register AI System -> Collect Context -> Identify Risks and Policies -> Apply Controls -> Collect Evidence -> Review and Monitor

3.2.3 Evaluation and Relevance to LCSP
Credo AI provides an important reference for connecting business context, regulatory requirements, controls, and evidence. This is relevant to LCSP because a legal requirement cannot be evaluated correctly without understanding the purpose and use of the AI system. However, Credo AI mainly operates as a broad governance layer, while LCSP places greater emphasis on using legal requirements to guide technical investigation inside a source-code repository.  
3.3 IBM watsonx.governance
3.3.1 System Overview
IBM watsonx.governance is an enterprise platform for managing and governing AI use cases, models, and other AI assets throughout their lifecycle. It supports business owners, developers, validators, risk teams, and compliance teams involved in developing and operating AI systems.  
3.3.2 Functional Approach
IBM's governance process begins with an AI use case, where the organization describes the business purpose of the AI system. Models and other AI assets are then linked to that use case. Information about development, evaluation, deployment, risks, and approvals is recorded throughout the lifecycle, allowing stakeholders to review the system and monitor changes over time. Regulatory requirements can also be linked to relevant AI use cases. The general flow is: Define AI Use Case → Associate AI Assets → Collect Governance Information → Review Risks and Requirements → Approve → Monitor
3.3.3 Evaluation and Relevance to LCSP
IBM watsonx.governance shows the importance of starting an assessment from the business use case, rather than analyzing an AI model without knowing how it is used. This supports LCSP's decision to collect business context before evaluating technical evidence. IBM also provides a useful reference for lifecycle tracking and audit history, although its public workflow focuses more on AI assets and lifecycle governance than detailed source-code investigation.
3.4 Saidot
3.4.1 System Overview
Saidot is an AI governance platform that connects AI systems with models, datasets, risks, policies, controls, and evidence through a governance graph. It is designed for governance, legal, compliance, risk, business, and technical teams responsible for AI systems.  
3.4.2 Functional Approach
Saidot first collects information about an AI system, such as its purpose, industry, organization role, and operating context. This information is used to identify relevant risks and requirements. The system then connects the AI system to policies and controls, while evidence is collected or reused to demonstrate how those controls are addressed. If information is missing or uncertain, users can provide additional input or review AI-generated suggestions. The general flow is: Register AI System → Collect Context → Classify Risk → Identify Policies and Controls → Collect Evidence → Human Review → Compliance Assessment
3.4.3 Evaluation and Relevance to LCSP
Saidot is useful to LCSP in two areas. First, its governance graph shows how relationships between systems, risks, controls, and evidence can be represented instead of storing them as separate lists. Second, its classification workflow shows the importance of requesting human input when available information is insufficient. LCSP follows similar principles, but its Program Evidence Graph represents technical relationships inside the repository rather than governance relationships between organizational objects.

4. Business Opportunity
   As AI-related regulations continue to develop, organizations need not only to identify which legal requirements may apply to their AI-enabled systems, but also to provide evidence showing how those requirements are addressed in practice. The existence of platforms such as Holistic AI, Credo AI, IBM watsonx.governance, and Saidot shows that this has become a real market need, with organizations looking for structured ways to manage AI use cases, risks, policies, controls, evidence, reviews, and audits. However, most existing solutions focus on AI governance at an organizational level, while verifying whether a specific legal requirement is actually reflected in the software implementation still requires information from different sources. Business teams provide the context in which the system is used, legal or compliance teams identify the relevant requirements, and technical teams must find evidence in the system to support or challenge those findings. When this process is handled manually, information may become inconsistent, important evidence may be missed, results can be difficult to explain, and the same work may need to be repeated whenever the software changes. This creates an opportunity for LCSP to connect business context, applicable legal requirements, and technical evidence within one assessment process. Instead of relying only on declared information, LCSP aims to translate relevant requirements into technical investigation objectives, collect traceable evidence from a specific repository version, and use that evidence as the basis for assessment, gap identification, and reporting. This can help organizations reduce repeated manual effort, improve consistency, and maintain clearer evidence for future review and reassessment.
5. Software Product Vision
   For organizations that develop or operate AI-enabled software and need to assess their legal compliance readiness, LCSP is a web-based compliance support platform that connects business context, applicable legal requirements, and traceable technical evidence from a selected source-code repository within one structured assessment process. The platform helps business, compliance, and technical teams understand what requirements need to be addressed, investigate how those requirements relate to the actual software implementation, identify compliance gaps, and maintain clear evidence for future review and reassessment. Unlike assessment processes that rely mainly on questionnaires, separate manual reviews, or information that is difficult to verify against the implemented system, LCSP focuses on linking relevant requirements with verifiable technical evidence. This allows organizations to perform compliance assessments in a more consistent, explainable, and traceable way while reducing repeated manual effort when the software changes.
6. Project Scope & Limitations
   The scope of the Legal Compliance Support Platform (LCSP) covers the collection of AI system context, technical investigation of a selected source-code repository, identification and evaluation of compliance-relevant evidence, AI risk classification, gap analysis, reporting, and maintenance of traceable assessment records.
   LCSP is designed as a compliance-support platform. It assists organizations in determining applicable AI governance requirements and evaluating available evidence against those requirements. The platform does not replace legal professionals, regulators, auditors, or formal conformity assessment bodies.
   The following major features and limitations define the current product scope.
   6.1 Major Features
   FE-01: User Authentication and Access Control
   Allow users to securely sign in to LCSP and access only the assessments, repositories, reports, and management functions that they are authorized to use within their organization.
   FE-02: AI System Assessment and Context Collection
   Allow the user to create an assessment and describe how AI is used in the system, including its purpose, users, processed data, decision-making role, and human oversight. LCSP can ask additional questions when important information is missing so that the assessment has enough context to continue.
   FE-03: Source Repository Connection and Version Selection
   Allow the user to connect and select a source-code repository for assessment. LCSP records the exact repository version being assessed so that collected evidence and assessment results can always be traced back to the same version of the software.
   FE-04: Technical Mapping of the Repository
   Analyze the selected repository and build a structured technical map, called the Program Evidence Graph, showing important relationships within the software, such as components, dependencies, data flows, AI usage, sensitive-data handling, and human-control mechanisms. This map helps LCSP understand where compliance-related evidence may exist in the system.
   FE-05: Source Code Analysis and Evidence Collection
   Analyze the source code using controlled analysis tools to find technical evidence relevant to compliance requirements. Each piece of evidence keeps information about where it was found so that users can review and verify the finding later.
   FE-06: Applicable Legal Requirement Identification
   Use the information collected about the AI system to determine which legal and governance requirements may apply to the assessment. LCSP links these requirements to governed legal sources and citations so that users can understand the basis of the assessment.
   FE-07: Translation of Legal Requirements into Technical Checks
   Convert applicable legal requirements into EngineeringRules, which describe what LCSP needs to look for in the software to evaluate each requirement. This allows a legal requirement to be connected to specific technical questions and evidence that can be checked in the repository.
   FE-08: Compliance Investigation Planning
   Create a plan for how each applicable requirement should be investigated. Based on the available business context, technical information, and EngineeringRules, LCSP determines what questions need to be answered and what evidence needs to be found.
   FE-09: Automated Compliance Investigation
   Use controlled AI agents to investigate the selected repository and find evidence related to the planned compliance questions. The agents can use only approved information and tools, and their findings are recorded as evidence for later evaluation rather than being treated automatically as final compliance decisions.
   FE-10: Human Review and Missing Information Resolution
   Allow authorized users to review important findings, provide missing information, and resolve conflicts between information declared by users and evidence found in the software. If LCSP cannot continue because essential information is missing, the assessment can pause and request the required input before continuing.
   FE-11: Compliance Requirement Evaluation
   Evaluate the collected evidence against the conditions defined for each requirement and produce a clear result such as Compliant, Non-Compliant, or Unknown. When there is not enough reliable evidence, LCSP reports the result as Unknown instead of making an unsupported conclusion.
   FE-12: AI Risk Classification
   Determine the regulatory risk classification of the assessed AI system based on its purpose, usage context, applicable rules, and available assessment information. If important information required for classification is missing, LCSP can request additional input before completing the classification.
   FE-13: Compliance Gap Analysis
   Identify which applicable requirements are currently satisfied, which requirements have identified compliance gaps, and which requirements still lack enough information for evaluation. This helps users understand what needs further investigation or improvement.
   FE-14: Compliance Report Generation
   Generate an assessment report that summarizes the AI risk classification, compliance results, identified gaps, supporting evidence, and relevant legal references. The report remains linked to the assessment and the exact repository version that was reviewed.
   FE-15: Assessment History and Audit Trail
   Maintain a traceable history of important assessment information, including repository versions, collected evidence, assessment results, human review activities, and generated reports. This allows users to understand how an assessment result was reached and to review previous assessment states when needed.
   FE-16: Source Version Reassessment
   Allow the Manager to reassess an existing assessment when the source-code version changes. LCSP keeps the previous assessment results and starts a new analysis using the newly selected source version. The new technical evidence is then evaluated against the applicable requirements to produce updated compliance results and gaps. This allows the Manager to review how changes in the software affect the assessment without losing the history of previous versions.  
   FE-17: Scheduled Legal Corpus and Engineering Rule Update
   Allow LCSP to periodically check for approved updates to the legal corpus used by the platform. When relevant legal content changes, LCSP creates a new corpus version and updates the affected LegalRules and EngineeringRules so that future assessments use the latest governed requirements. Previous versions are kept for traceability, so earlier assessment results remain linked to the legal and engineering rule versions that were used at the time.

6.2 Limitations & Exclusions
LI-01: LCSP does not provide official legal certification
LCSP supports compliance assessment and provides evidence to explain assessment results. It does not issue legal certificates, conformity approvals, or official compliance decisions on behalf of regulators or authorized certification bodies.
LI-02: LCSP does not replace legal or compliance professionals
LCSP is designed to support assessment and decision-making. Complex legal matters or cases that require an official legal conclusion must still be reviewed by qualified legal or compliance professionals.
LI-03: LCSP only evaluates legal requirements supported by the system
LCSP can assess only the laws, regulations, and compliance requirements that have been defined and governed within the platform. Requirements from unsupported regulations or jurisdictions are not automatically included in an assessment.
LI-04: LCSP does not force a compliance conclusion when information is insufficient
If required business context, evidence, or other assessment information is missing, unclear, or conflicting, LCSP may request additional input or return an UNKNOWN result instead of making an unsupported compliance conclusion.
LI-05: LCSP does not automatically perform remediation
LCSP can identify compliance gaps and indicate areas that may require improvement. However, it does not automatically modify software, change business processes, or implement corrective actions on behalf of the organization.
LI-06: LCSP does not perform regulatory procedures on behalf of the organization
LCSP can generate reports, supporting evidence, and assessment history for review or audit preparation. It does not directly submit regulatory documents, register AI systems, or communicate with regulatory authorities on behalf of users.
LI-07: LCSP is not a general enterprise governance platform
LCSP focuses on AI compliance assessment and technical verification. Broader functions such as enterprise-wide risk management, financial auditing, cybersecurity management, or complete internal policy management are outside the main scope of the product.
LI-08: LCSP does not provide real-time production monitoring of AI systems
LCSP supports assessments and scheduled reassessments, but it is not designed as a runtime monitoring platform that continuously observes every AI output, behavior, or incident while the AI system is operating.
LI-09: Automated Documentation Context is not included in the current scope
The current version of LCSP does not automatically collect and analyze all internal organizational documents, such as SOPs, internal policies, guidelines, or operational documents, as a separate Documentation Context source. Required assessment information must be provided through the context sources currently supported by LCSP.
