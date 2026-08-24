**CAPSTONE PROJECT REPORT**

# Report 1 – Project Introduction

**Hanoi, August 2026**

> This repository copy mirrors the current Capstone content at product/business level. Personal email addresses and phone numbers are intentionally omitted because this repository is public.

## I. Record of Changes

| Date | A* / M / D | In charge | Change Description |
| --- | --- | --- | --- |
| 19/8/26 | A* | Phan N.Q. Minh | Initial Project Introduction. |
| 24/8/26 | M | Phan N.Q. Minh | Updated product background, benchmark systems, vision, scope, major features, and product limitations to reflect the current LCSP scope. |

*A - Added; M - Modified; D - Deleted*

# II. Project Introduction

## 1. Overview

### 1.1 Project Information

- **Project name:** A Legal Compliance Support Platform for Businesses Using Artificial Intelligence in Vietnam
- **Project code:** SEP490
- **Group name:** SE_30
- **Software type:** Web App

### 1.2 Project Team

| Full Name | Role |
| --- | --- |
| Nguyen Phuong Tam | Lecturer |
| Phan Nguyen Quoc Minh | Leader |
| Le Bao Nhi | Member |
| Nguyen Anh Tu | Member |
| Nguyen Tuan Anh | Member |
| Tran Nguyen Dang Thuy | Member |

Contact details are maintained in the formal submission copy and are not published in this public repository.

## 2. Product Background

Artificial intelligence is increasingly used in business products and internal operations. As its use grows, organizations need a clearer way to understand how AI is being used, what information supports that understanding, and which legal requirements may apply. LCSP was initiated to bring these areas together in a structured assessment process for businesses using AI in Vietnam.

LCSP is developed to help organizations collect and review the information needed for a compliance assessment in one place. The platform combines information provided by the business, relevant information from the connected software project, and legal requirements so that the assessment can be reviewed more consistently and with clearer supporting evidence.

A key principle of the project is that conclusions should be supported by available evidence. When important information is missing, the system should indicate that further clarification is needed instead of making assumptions. Human review remains an important part of the assessment, especially when legal interpretation or business judgment is required.

## 3. Existing Systems

The following products are relevant references because they address enterprise AI governance and compliance workflows. They are used as benchmarks for product positioning, not as evidence that their implementation is identical to LCSP.

### 3.1 IBM watsonx.governance

IBM watsonx.governance is an enterprise AI governance platform that helps organizations manage AI-related risks, policies, regulatory obligations, monitoring, and accountability across the AI lifecycle. It provides a useful reference for how large organizations can organize governance activities and maintain evidence for review.

- **Website:** https://www.ibm.com/products/watsonx-governance
- **Reference value for LCSP:** mature governance workflows, lifecycle visibility, policy enforcement, and audit/compliance management.
- **LCSP differentiation:** LCSP has a narrower focus on helping businesses using AI in Vietnam prepare and review evidence for legal compliance assessments. Instead of serving as a broad enterprise governance platform, LCSP connects business information, relevant project information, legal requirements, and assessment results in one review process.

### 3.2 Credo AI

Credo AI provides an AI governance platform that helps organizations keep track of AI systems, manage risks, support compliance work, monitor governance activities, and connect regulatory requirements with business context. It also demonstrates how automation can support governance work while important decisions remain under human oversight.

- **Website:** https://www.credo.ai/product
- **Reference value for LCSP:** centralized governance context, regulation-to-control mapping, integrations, evidence workflows, and human-governed automation.
- **LCSP differentiation:** LCSP focuses on a practical assessment process for AI-related legal compliance in Vietnam. It helps users gather supporting information, compare that information with relevant legal requirements, identify gaps, and prepare results for human review.

## 4. Business Opportunity

Organizations adopting AI need to understand three things clearly: how AI is used in the business, what the software actually does, and what legal requirements may apply. In practice, this information is often handled by different people and stored in different places, making assessments time-consuming and difficult to review consistently.

LCSP addresses this problem by bringing business information, project evidence, legal requirements, assessment findings, and reports into one process. This can help businesses using AI in Vietnam reduce manual review effort, keep supporting information organized, and explain more clearly how an assessment result was reached.

## 5. Software Product Vision

For businesses using or building AI-enabled software in Vietnam, LCSP aims to provide a practical platform for preparing and reviewing information related to legal compliance. The system helps users describe how AI is used, connect relevant project information, review applicable legal requirements, identify compliance gaps, and generate reports for further review. LCSP is intended to support human decision-making rather than replace legal professionals or provide compliance certification.

## 6. Project Scope & Limitations

LCSP covers the main activities needed to support an AI compliance assessment: creating an assessment, collecting business and product information, connecting relevant project information, reviewing legal requirements, identifying potential compliance gaps, and preparing reports for review. The system is designed as a compliance-support product and does not replace professional legal advice, provide certification, or submit information directly to regulators.

### 6.1 Major Features

- **FE-01:** Create and manage compliance assessments, then collect the business and product information needed for each assessment through a guided process.
- **FE-02:** Connect a software project repository and select the project version to be reviewed so that assessment findings can be linked to the correct source information.
- **FE-03:** Review the connected software project to identify information related to AI usage and collect supporting evidence that may be relevant to the assessment.
- **FE-04:** Maintain relevant legal sources and organize legal requirements into assessment criteria that can be reviewed consistently against the collected information.
- **FE-05:** Use AI-assisted analysis to help review collected information, find relevant supporting evidence, and ask users for additional information when important details are missing. The AI supports the assessment process but does not make legal decisions on its own.
- **FE-06:** Check the collected evidence against each assessment criterion and clearly show whether the available information supports the requirement, indicates a possible gap, or is not yet sufficient for a conclusion.
- **FE-07:** Summarize identified compliance gaps, supporting evidence, and assessment findings in reports that help users understand what was reviewed and what may require further attention.
- **FE-08:** Protect assessment information through appropriate access control, privacy safeguards, activity records, and review history so that important evidence and results can be traced and reviewed when needed.

### 6.2 Limitations & Exclusions

- **LI-01:** LCSP does not provide formal legal advice, compliance certification, or direct submission to government authorities. Its outputs are intended to support review and should be checked by appropriate human or legal reviewers when necessary.
- **LI-02:** AI-assisted analysis is used only to support the assessment process. Important conclusions should not rely solely on an AI-generated response, especially when legal interpretation or business judgment is required.
- **LI-03:** Some planned improvements, such as collecting broader business context, accepting more supporting documents, and supporting more flexible connections to software repositories, are still under development and are not part of the completed project scope yet.
- **LI-04:** The current project scope does not include a complete view across multiple repositories, broad integration with external knowledge sources, or a general knowledge base for every connected software project.
- **LI-05:** LCSP cannot fully observe every behavior of an AI-enabled system from project information alone. Some behaviors may depend on external services, runtime conditions, or information that is not available during the assessment.
- **LI-06:** When important evidence is missing or the available project information is not sufficient, the system may be unable to reach a clear assessment result and additional review or clarification may be required.
- **LI-07:** Privacy and security requirements limit how sensitive source code, credentials, and other confidential information can be used during analysis. The system should only access and retain information that is necessary for the assessment.
- **LI-08:** The project is focused on supporting legal compliance assessments for AI use in Vietnam. Compliance workflows for multiple countries and broad enterprise-wide user administration are outside the current project scope.
