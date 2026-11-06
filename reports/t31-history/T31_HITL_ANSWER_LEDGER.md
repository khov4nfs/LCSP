# T31 Controlled Assessment v2 — HITL Answer Ledger

- **Assessment ID:** `5ec45c57-3625-4368-bedc-22824a396e5e`
- **Assessment Name:** T31 - Post Fix Controlled Validation
- **Pinned Rule Set:** `lcsp-360-official-eight-document-acceptance-corpus.v1.p1` (`97004ff3-9240-4e37-8a94-9ade8832c00a` — 243 active rules)
- **Target Repository:** `https://github.com/tkhudson/AI-Powered-Customer-Support-Chatbot` @ `65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b`
- **Locked Business Scenario:** `T31-S01` (SYN Support Services / Hudson IT Consulting)

---

## Question 1: AI Development, Deployment, and Capacity Scope

- **Request ID:** `cd5816ce-3eaa-490c-9b22-438b640018ba`
- **Assessment Rule ID:** `art3-cl1-pta-risk-prevention` (Decision 1290/QD-BKHCN, Article 3, Clause 1 — General Principles for Responsible AI / Risk Prevention)
- **Unresolved Fact:** Whether the assessed system's operators develop, deploy, or use AI systems within the scope of Vietnam's AI ethics framework, and in what capacity and at what scale.
- **Question Prompt:**
  > "Does your operation actually develop, deploy, or use AI systems in the course of its activities? For example, does it provide or operate AI-based products or services, use AI models as part of a deployed application, or otherwise integrate AI into software that you run or offer to users? Please describe the capacity in which you do so (e.g., commercial AI provider, deployer of an AI product, internal/in-house use, or personal/hobby development), whether any such AI system is deployed or offered to users, and at what scale."
- **Mapped Locked Facts (`T31-S01`):**
  - **Operator Entity:** SYN Support Services (Vietnam-registered entity operating under the Hudson IT Consulting brand).
  - **Operating Capacity:** Commercial deployer of an AI application. SYN does not develop or pre-train foundation AI models.
  - **System Nature:** AI-powered customer support chatbot integrating external commercial LLM APIs (OpenAI, Gemini, Claude) via API keys.
  - **Deployment Target & Scale:** Deployed publicly on the web for prospective and active consulting clients; small-to-medium enterprise scale (hundreds to a few thousand chat sessions/month).
- **Submitted Answer:**
  > "SYN Support Services (operating under the Hudson IT Consulting brand) is a commercial deployer of an AI-powered customer support chatbot. We do not develop or train foundational AI models in-house. Instead, our software integrates external commercial LLM APIs to provide automated customer support and consultation for prospective IT consulting clients. The system is deployed as a web application accessible to our clients at small-to-medium scale (handling several hundred to a few thousand interactions per month)."
- **Submission Method:** Real browser subagent typing into `#answer-cd5816ce-3eaa-490c-9b22-438b640018ba-text` and clicking Send.
- **Timestamp:** 2026-11-02T13:22:00Z
- **Resolution Status:** RESOLVED (Event 788)

---

## Question 2: AI Risk Classification & Domain Scope

- **Request ID:** `c9d040b3-81b6-44d1-91c6-b0a564af93e0`
- **Assessment Rule ID:** `c05-conformity-assessment-rule`
- **Unresolved Fact:** The risk classification (high/medium/low) of the commercially deployed AI customer-support chatbot, which determines whether high-risk-specific AI duties (conformity assessment, deployer risk management, provider assessment methods, and risk-management measures) attach.
- **Question Prompt:**
  > "Has your company classified the AI-powered customer support chatbot by risk level under Vietnam's AI regulations (high-risk, medium-risk, or low-risk)? If so, what is that classification? Specifically, does the chatbot appear on the government's list of high-risk AI systems, or does it fall under any medium-risk category (for example, in areas such as employment, education, healthcare, critical infrastructure, biometric identification, or law enforcement)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Risk Classification:** Low-risk AI system.
  - **Operational Domain:** General commercial customer support / FAQ consultation for IT consulting inquiries.
  - **Exclusion of Sensitive Sectors:** Not used in healthcare, education admissions, employment/recruitment filtering, critical infrastructure management, biometric identification, public services, or law enforcement.
  - **High-Risk List:** Does not appear on any government high-risk AI lists.
  - **Decision Autonomy:** Informational text response generation only; no automated legal, financial, or transactional decision-making.
- **Submitted Answer:**
  > "Our company (SYN Support Services) classifies the AI-powered customer support chatbot as a low-risk AI system. It operates solely as an informational customer service assistant for prospective and current clients seeking IT consulting services. It does not appear on any government list of high-risk AI systems, nor does it operate in any high-risk or sensitive medium-risk domains such as healthcare, education admissions, employment screening, critical infrastructure, biometric identification, or law enforcement. It does not make automated legal or financial decisions and only provides informational chat responses."
- **Submission Method:** Real browser subagent typing into `#answer-c9d040b3-81b6-44d1-91c6-b0a564af93e0-text` and clicking Send.
- **Timestamp:** 2026-11-02T13:58:00Z
- **Resolution Status:** RESOLVED (Event 885)

---

## Question 3: Review and Reclassification Trigger Events

- **Request ID:** `3a2ac61a-34e5-41ef-b894-cc701e1ee8d2`
- **Assessment Rule ID:** `ar-nd142-art11-cl1-review-reclassification` (Decree 142/2026/ND-CP, Article 11, Clause 1 — Review and Reclassification Triggers)
- **Unresolved Fact:** Whether any enumerated legal event triggering a duty to review and reclassify the AI system has occurred (significant function/purpose/context change, serious incident, government listing decision, or written authority request).
- **Question Prompt:**
  > "Has any of the following occurred with respect to your AI-powered customer support chatbot: (a) a significant change to its functions, intended use, or deployment context that could affect its risk classification; (b) a serious incident demonstrating that it poses risk higher than its classified level; (c) a government decision amending the high-risk AI list that changes the chatbot's risk level; or (d) a written request from a competent state authority to review or reclassify the chatbot?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Functions / Purpose / Context:** Text-only informational assistant for IT consulting inquiries; no functional, architectural, or context alterations.
  - **Incidents:** No serious incidents, systemic harms, or formal complaints registered.
  - **Government Decisions / Authority Requests:** No regulatory list amendments affecting the chatbot; no written authority orders received.
- **Submitted Answer:**
  > "None of these events have occurred with respect to our AI-powered customer support chatbot. Specifically: (a) there has been no significant change to its functions, intended use, or deployment context (it remains strictly a text-only informational customer service assistant for consulting inquiries); (b) no serious incidents or complaints indicating a higher risk level have occurred; (c) no government decision amending the high-risk AI list has altered the chatbot's risk level; and (d) we have received no written request from any competent state authority to review or reclassify the chatbot."
- **Submission Method:** Real browser subagent typing into `#answer-3a2ac61a-34e5-41ef-b894-cc701e1ee8d2-text` and clicking Send.
- **Timestamp:** 2026-11-02T14:35:47Z
- **Resolution Status:** RESOLVED (Event 986)

---

## Question 4: Deployer Modification and Risk Escalation

- **Request ID:** `eb338c55-9e9d-49d5-b3c9-5f2a5c6e9ce6`
- **Assessment Rule ID:** `ar-nd142-art11-cl2-coordinate-reclassification` (Decree 142/2026/ND-CP, Article 11, Clause 2 — Deployer Modifications & Coordinated Reclassification)
- **Unresolved Fact:** Whether the deployer modified/integrated/changed the AI system's functions so as to create new or higher risk versus the provider's initial classification.
- **Question Prompt:**
  > "Have you modified, integrated, or changed the functions of the AI customer support chatbot in a way that creates new or higher risk than the risk level originally classified by the AI provider?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Integration Model:** BYOK client proxy forwarding prompts to upstream commercial LLM APIs.
  - **No High-Risk Alterations:** No fine-tuning, no model weight manipulation, no transactional/financial workflows, no CRM/database modifications, no voice/video channels.
- **Submitted Answer:**
  > "No, we have not modified, integrated, or changed the functions of the AI customer support chatbot in any way that creates new or higher risk beyond the risk level of the underlying LLM providers. Our application simply provides a text-only conversational interface where users provide their own API keys (BYOK) for IT consulting FAQ assistance. We do not modify foundation models, perform fine-tuning, or integrate automated transactional, financial, medical, or administrative actions."
- **Submission Method:** Real browser subagent typing into `#answer-eb338c55-9e9d-49d5-b3c9-5f2a5c6e9ce6-text` and clicking Send.
- **Timestamp:** 2026-11-02T14:37:04Z
- **Resolution Status:** RESOLVED (Event 988)

---

## Question 5: Serious Incident Occurrence & Remediation Measures

- **Request ID:** `32690d72-69ad-4da8-8145-20c6ab00f794`
- **Assessment Rule ID:** `ar-luat134-art12-cl2a-technical-measures` (Law 134/2025/QH15, Article 12, Clause 2(a) — Safety, Security, and Incident Remediation)
- **Unresolved Fact:** Whether any serious incident or security compromise has occurred requiring urgent technical remediation, suspension, recall, or authority notification.
- **Question Prompt:**
  > "Have any serious incidents, systemic harms, or security breaches occurred during the operation of your AI customer support chatbot that required immediate technical intervention, service suspension, or regulatory notification?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Incident Register:** No serious incidents, data breaches, or safety compromises recorded in operating logs.
- **Submitted Answer:**
  > "No, no serious incidents have occurred with respect to our AI customer support chatbot. There has been no harm, systemic failure, or security compromise requiring urgent technical remediation, suspension, recall, or notification to authorities. The application operates stably and securely as an informational consulting assistant."
- **Submission Method:** Real browser subagent typing into `#answer-32690d72-69ad-4da8-8145-20c6ab00f794-text` and clicking Send.
- **Timestamp:** 2026-11-02T14:37:43Z
- **Resolution Status:** RESOLVED (Event 990)

---

## Question 6: Higher-Risk Reclassification Authority Notification

- **Request ID:** `a42806a3-03ee-49a1-ac9b-a55beaa56826`
- **Assessment Rule ID:** `ar-nd142-art11-cl3pt-a-notify-higher` (Decree 142/2026/ND-CP, Article 11, Clause 3(a) — Notification to Competent Authority Upon Reclassification to Higher Risk)
- **Unresolved Fact:** Whether any review or reclassification has determined that the chatbot poses higher risk than originally classified, triggering authority notification obligations.
- **Question Prompt:**
  > "Has any internal or external review concluded that your AI customer support chatbot operates at a higher risk level than previously classified, and has any notification been submitted to the competent authority?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Risk Invariant:** Chatbot remains strictly classified as low-risk; no escalation has occurred or been required.
- **Submitted Answer:**
  > "No review or reclassification of our AI customer support chatbot has concluded that its risk level is higher than previously classified. No notification to any competent state authority has been required or issued, as the application remains a low-risk, text-only informational assistant using BYOK."
- **Submission Method:** Real browser subagent typing into `#answer-a42806a3-03ee-49a1-ac9b-a55beaa56826-text` and clicking Send.
- **Timestamp:** 2026-11-02T14:38:32Z
- **Resolution Status:** RESOLVED (Event 992)

---

## Question 7: National AI Infrastructure - Standards & Governance

- **Request ID:** `977f1a2a-f737-4450-b6ce-4aa11a25c0b4`
- **Assessment Rule ID:** `ars-art30-cl3-pt-a-standards`
- **Unresolved Fact:** Whether the assessed organization manages, operates, or participates in Vietnam's national AI infrastructure network.
- **Question Prompt:**
  > "Does your organization manage, operate, or participate (including by connecting, sharing, or exploiting) in Vietnam's national artificial intelligence infrastructure network (mạng lưới hạ tầng trí tuệ nhân tạo quốc gia)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Infrastructure Invariant:** Hudson IT Consulting operates standard private cloud / web deployments, not connected to or participating in national AI infrastructure networks.
- **Submitted Answer:**
  > "No, our organization does not manage, operate, or participate in Vietnam's national AI infrastructure network (mang luoi ha tang tri tue nhan tao quoc gia). We do not connect to, share, or exploit any national AI computing infrastructure or national supercomputing centers. Our application is simply a standard web-deployed customer support chatbot where users supply their own commercial API keys (BYOK) to communicate with external commercial model providers."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T15:30:23Z
- **Resolution Status:** RESOLVED

---

## Question 8: National AI Infrastructure - Information Security

- **Request ID:** `1fad892e-3dde-45ae-9b3c-7e6f9afb9529`
- **Assessment Rule ID:** `ars-art30-cl3-pt-b-security`
- **Unresolved Fact:** Whether the assessed organization participates in the national AI infrastructure network and is subject to network information security duties.
- **Question Prompt:**
  > "Does your organization manage, operate, or participate (including by connecting, sharing, or exploiting) in Vietnam's national artificial intelligence infrastructure network (mạng lưới hạ tầng trí tuệ nhân tạo quốc gia)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Infrastructure Invariant:** Not participating in national AI infrastructure network.
- **Submitted Answer:**
  > "No, our organization does not manage, operate, or participate in Vietnam's national AI infrastructure network. We do not connect to or exploit national AI supercomputing resources. Our application operates solely on standard commercial cloud environments using BYOK."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T15:10:18Z
- **Resolution Status:** RESOLVED

---

## Question 9: National AI Infrastructure - Safety Assessment

- **Request ID:** `79f3bfa5-5dec-408e-89eb-3a129cce39e7`
- **Assessment Rule ID:** `ars-art30-cl3-pt-c-safety`
- **Unresolved Fact:** Whether the assessed organization operates within national AI infrastructure and is subject to national infrastructure safety duties.
- **Question Prompt:**
  > "Does your organization manage, operate, or participate (including by connecting, sharing, or exploiting) in Vietnam's national artificial intelligence infrastructure network (mạng lưới hạ tầng trí tuệ nhân tạo quốc gia)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Infrastructure Invariant:** Standard web deployment, no national AI infrastructure involvement.
- **Submitted Answer:**
  > "No, our organization does not manage, operate, or participate in Vietnam's national AI infrastructure network (mang luoi ha tang tri tue nhan tao quoc gia). We do not connect to, share, or exploit any national AI computing infrastructure or national supercomputing centers. Our application is simply a standard web-deployed customer support chatbot where users supply their own commercial API keys (BYOK) to communicate with external commercial model providers."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T15:30:31Z
- **Resolution Status:** RESOLVED

---

## Question 10: National AI Infrastructure - Interoperability Standards

- **Request ID:** `b109c029-e736-416c-af5f-3027cdaf6d68`
- **Assessment Rule ID:** `ars-art31-cl2-standards`
- **Unresolved Fact:** Whether the assessed organization participates in national AI infrastructure requiring compliance with national interoperability standards.
- **Question Prompt:**
  > "Does your organization manage, operate, or participate in Vietnam's national AI infrastructure network?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Infrastructure Invariant:** No national AI infrastructure participation.
- **Submitted Answer:**
  > "No, our organization does not manage, operate, or participate in Vietnam's national AI infrastructure network (mang luoi ha tang tri tue nhan tao quoc gia). We do not connect to, share, or exploit any national AI computing infrastructure or national supercomputing centers. Our application is simply a standard web-deployed customer support chatbot where users supply their own commercial API keys (BYOK) to communicate with external commercial model providers."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T15:19:04Z
- **Resolution Status:** RESOLVED

---

## Question 11: Personal Data Processing Service Business Eligibility

- **Request ID:** `cc69d5c9-aebd-4fa1-8445-227b7a0acf62`
- **Assessment Rule ID:** `AR-NGHIDINH356-2025-ART25-CL2-DEAN-NOIDUNG`
- **Unresolved Fact:** Whether the organization operates as a commercial provider of personal data processing services requiring a specialized business license/certificate.
- **Question Prompt:**
  > "Has your organization applied for (or does it hold) a certificate of eligibility for personal-data-processing service business under Decree 356/2025/ND-CP?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Business Scope:** Software and IT consulting; not a commercial personal data processing service provider.
- **Submitted Answer:**
  > "No, our organization has not applied for and does not hold a certificate of eligibility for personal-data-processing service business. Our application is a standard web-deployed customer support chatbot utilizing bring-your-own-keys (BYOK) for external model APIs and does not engage in commercial personal data processing services as defined in the decree."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T15:16:02Z
- **Resolution Status:** RESOLVED

---

## Question 12: Business Sector & Prohibited Regulated Domains

- **Request ID:** `d966e54c-914e-4b88-8a2c-48ebc5d9a7dd`
- **Assessment Rule ID:** `art27-cl1-pt-a-sensitivedata-rule`
- **Unresolved Fact:** The business sector and regulated activities of the assessed organization (specifically financial/banking/recruitment/mobile app platforms).
- **Question Prompt:**
  > "Please describe your organization's business activities and the sector(s) in which it operates. In particular: does it provide banking, financial, or credit-information services; recruitment or labor placement services; or a public mobile application platform?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Sector Scope:** Private IT consulting and software architecture; excluded from banking, finance, labor placement, or mobile app stores.
- **Submitted Answer:**
  > "Our organization, Hudson IT Consulting, is a private enterprise operating strictly in the information technology and software consulting sector. We specialize in software architecture consulting and custom artificial intelligence solution integration for corporate IT clients. We do not operate in the financial, banking, or credit-information sectors, we do not conduct labor recruitment or employment agency services, and we do not develop or provide a public mobile application platform."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T16:38:18Z
- **Resolution Status:** RESOLVED

---

## Question 13: Personal Data Controller / Processor Role & Storage Scope

- **Request ID:** `cdb0fd39-89f8-4859-b125-cb349ed9bbf0`
- **Assessment Rule ID:** `art18-cl1-storage-protection-rule`
- **Unresolved Fact:** Whether the assessed organization processes personal data as a data controller, processor, or not at all in operating the chatbot.
- **Question Prompt:**
  > "In operating the assessed AI customer-support chatbot, does your organization process personal data of users (for example, collect, store, or transmit personal data such as names, contact details, or message content), and if so, in what capacity (for example, as a data controller, a processor, or not at all)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Data Processing Invariant:** Ephemeral BYOK client proxy; does not collect, persist, or process user personal data as controller or processor.
- **Submitted Answer:**
  > "No, in operating the assessed AI customer-support chatbot, our organization does not act as a personal data controller or processor. The application operates solely as a demonstration web interface where users provide their own API keys (BYOK) to communicate directly with third-party LLM providers. User session messages and temporary context remain strictly in volatile browser/client memory for the duration of the active session and are never transmitted to, stored in, or retained by any backend database, persistent storage, or secondary data-processing pipeline owned or operated by our organization."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T16:38:27Z
- **Resolution Status:** RESOLVED

---

## Question 14: State Agency Status

- **Request ID:** `1d5f8bd2-b80f-4763-be1e-407bd455cffb`
- **Assessment Rule ID:** `art20-cl1-assessment`
- **Unresolved Fact:** Whether the assessed organization is a state agency.
- **Question Prompt:**
  > "Is your organization a state agency (a government body or public authority), or is it a private/independent organization?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Entity Type:** Private commercial software enterprise.
- **Submitted Answer:**
  > "Our organization is a private, independent commercial software consulting enterprise (Hudson IT Consulting). It is not a state agency, government body, public authority, or any state-funded administrative institution."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T16:38:34Z
- **Resolution Status:** RESOLVED

---

## Question 15: Cybersecurity Level Classification (Law 116/2025)

- **Request ID:** `10af66a6-961b-4daa-b9d9-241162908567`
- **Assessment Rule ID:** `rule-lnm-art10-cl3-level1-2-tasks`
- **Unresolved Fact:** The cybersecurity level classification of the assessed system (Level 1–5) and whether it is in the national critical security systems catalog.
- **Question Prompt:**
  > "Does your AI customer-support chatbot system hold a cybersecurity level classification (Cấp độ an ninh mạng) under Vietnam's Cyber Security Law 116/2025, and if so at which level (1 through 5)? Is this system listed in the national catalog of critical information systems related to national security (danh mục hệ thống thông tin quan trọng về an ninh quốc gia)?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Cybersecurity Classification:** Level 1 (Cấp độ 1); NOT Level 2, 3, 4, or 5; NOT listed in national critical security systems catalog.
- **Submitted Answer:**
  > "Our AI customer-support chatbot system is an informational customer service tool classified under Cấp độ 1 (Level 1) of cybersecurity classification under Vietnam's cybersecurity regulations (Law 116/2025). The system is not classified at Level 2, 3, 4, or 5. Furthermore, this system is not listed in the national catalog of critical information systems related to national security (danh mục hệ thống thông tin quan trọng về an ninh quốc gia)."
- **Submission Method:** Real browser subagent via web UI.
- **Timestamp:** 2026-11-02T17:58:24Z
- **Resolution Status:** RESOLVED

---

## Question 16: Level-1 Network Security Protection Duties (Article 10 Clause 1/3)

- **Request ID:** `4b4f3751-5d95-4fbc-9603-23dbe339869a`
- **Assessment Rule ID:** `rule-lnm-art10-cl3-level1-2-tasks`
- **Unresolved Fact:** Whether the operator actually performs Article 10 clause 1 network-security protection duties (b–e) for Level-1 systems.
- **Question Prompt:**
  > "For your AI customer-support chatbot system (classified at cybersecurity Level 1 under Law 116/2025), does your organization actually perform the network-security protection duties in Article 10 clause 1: (b) assessing and managing the system's cybersecurity risk; (c) urging, supervising, and inspecting the network-security protection work; (d) organizing the deployment of network-security protection measures; (đ) carrying out the reporting regime under the regulations; and (e) organizing outreach and awareness-raising on network security?"
- **Mapped Locked Facts (`T31-S01`):**
  - **Operator Compliance:** Performs periodic risk assessments, inspects protective measures, deploys standard transport/CORS protections, maintains incident logs for statutory reporting, conducts regular awareness training.
- **Submitted Answer:**
  > "Yes, our organization performs network-security protection duties for our AI customer-support chatbot system (classified at Level 1 under Law 116/2025), including assessing and managing cybersecurity risks, supervising network-security protection work, deploying security measures, adhering to reporting regimes, and organizing awareness-raising activities."
- **Submission Method:** Real browser subagent typing into `#answer-4b4f3751-5d95-4fbc-9603-23dbe339869a-text` and clicking Send.
- **Timestamp:** 2026-11-02T18:09:39Z
- **Resolution Status:** RESOLVED



