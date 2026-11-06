# Legal Rule Set Audit & Quality Review Matrix: T31 Acceptance Corpus

- **Governing Rule Set Version:** `97004ff3-9240-4e37-8a94-9ade8832c00a`
- **Rule Set Identifier:** `lcsp-360-official-eight-document-acceptance-corpus.v1.p1`
- **Total Rules in Corpus:** 243 active rules
- **Review Date:** November 2, 2026
- **Auditor Role:** Legal Rule Set Quality Reviewer & AI Agent Systems Auditor
- **Status:** **LEGAL_REVIEW_PENDING** (Phase 2 Exit Gate: **PARTIAL**)

---

## 1. Executive Summary & Audit Purpose

An exhaustive statutory and structural audit of the 243 rules pinned in `lcsp-360-official-eight-document-acceptance-corpus.v1.p1` was conducted to verify whether the legal rules accurately reflect statutory addressee scope, modality, conditions, and exceptions under Vietnamese law.

### Primary Legal Defect Findings
1. **Machine-Readable AI Output Marking (Text-Only Modality Defect):**
   - **Rule ID:** `luat134-art11-cl2-machine-readable-marking-impl` (Law 134/2025/QH15 Art 11(2) & Decree 142/2026/NĐ-CP Art 17(1)).
   - **Discrepancy:** The statutory obligation to implement machine-readable technical markers is explicitly restricted to **audio, image, and video** (`nội dung âm thanh, hình ảnh, video`). It does **not** mandate watermarking for plain text outputs. The current rule definition was modeled as `Applicability mode: UNCONDITIONAL`, causing text-only chatbots (such as T31) to be incorrectly penalized as `NON_COMPLIANT`.
2. **Circular 05/2026/TT-BKHCN AI Ethics Framework (Modality & Addressee Defect):**
   - **Rule IDs:** All 15 rules under Circular 05/2026/TT-BKHCN (`art3-cl1-pta` through `art3-cl4-ptb`).
   - **Discrepancy:** Under Article 1 Clause 2, Circular 05 is mandatory **only** for state agencies and AI systems serving state management or public services (`phục vụ hoạt động quản lý nhà nước hoặc cung cấp dịch vụ công`). Under Article 1 Clause 3, private commercial enterprises are **encouraged** (`được khuyến khích áp dụng`), establishing a voluntary ethical recommendation rather than a statutory duty. The current rule set modeled all 15 rules with `Modality: DUTY` and `Applicability mode: UNCONDITIONAL`, generating 15 false-positive statutory violations against private commercial deployers.

---

## 2. Granular Legal Rule Set Review Matrix

| Rule ID | Original Provision | Current Rule Set Model | Identified Statutory Discrepancy | Corrected Legal Interpretation | Exact Legal Source Citation | Confidence & Status | Required Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| `luat134-art11-cl2-machine-readable-marking-impl` | Law 134/2025/QH15 Art 11(2); Decree 142/2026/NĐ-CP Art 17(1) | `Actor: Provider`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates machine-readable markers on all AI outputs without conditioning on modality. Text-only chatbots cannot comply with audiovisual watermarking standards. | Scope is strictly conditioned on output format: applies **only** if the AI system generates audio, images, or video. Text-only chatbots are `NOT_APPLICABLE`. | Law 134 Art 11(2): *"các nội dung âm thanh, hình ảnh, video do hệ thống trí tuệ nhân tạo tạo ra"*; Decree 142 Art 17(1): *"nội dung đầu ra là âm thanh, hình ảnh hoặc video"*. | **CONFIRMED** | Rule Set correction: Add condition `[Output format in {audio, image, video}]`. |
| `AR-art17-cl1-mark-ai-content` | Decree 142/2026/NĐ-CP Art 17(1) | `Actor: AI Provider`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Unconditional obligation on AI providers to mark audio/image/video outputs without checking if the system produces those media formats. | Add condition: Evaluated system must have audio, image, or video generation capabilities. For text-only FAQ assistants, rule is `NOT_APPLICABLE`. | Decree 142 Art 17(1): *"nội dung đầu ra là âm thanh, hình ảnh hoặc video được đánh dấu ở định dạng máy đọc"*. | **CONFIRMED** | Rule Set correction: Bind applicability condition to media output capability. |
| `art3-cl1-pta-risk-prevention` | Circular 05/2026/TT-BKHCN Art 3(1)(a) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Modeled as an unconditional statutory duty for all organizations/individuals operating AI. | Under Circular 05 Art 1(2)-(3), mandatory only for state agencies and public services. Private commercial systems are *encouraged* (`khuyến khích`), making it non-mandatory. | Circular 05 Art 1(2): *"phục vụ hoạt động quản lý nhà nước hoặc cung cấp dịch vụ công"*; Art 1(3): *"được khuyến khích áp dụng"*. | **CONFIRMED** | Rule Set correction: Add applicability condition `[Scope: State management OR Public service]`. |
| `art3-cl1-ptb-quality-assurance` | Circular 05/2026/TT-BKHCN Art 3(1)(b) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Converts an ethical recommendation into an unconditional statutory requirement for testing and audit. | Same as above: Private commercial systems not serving public services are exempt from mandatory compliance. | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl1-ptc-human-oversight` | Circular 05/2026/TT-BKHCN Art 3(1)(c) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Treats human intervention mechanism as a mandatory duty under Circular 05. Note: Law 134 has separate provisions. | Circular 05's general human oversight framework is voluntary for private enterprise; mandatory human oversight must cite Law 134 directly where applicable. | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Correct Circular 05 scope condition. |
| `art3-cl1-ptd-resilience` | Circular 05/2026/TT-BKHCN Art 3(1)(d) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Unconditional duty to build error handling, feedback, and contingency plans under ethical framework. | Voluntary for private commercial operators under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl1-pte-security` | Circular 05/2026/TT-BKHCN Art 3(1)(e) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates protective measures against adversarial attacks/poisoning under Circular 05. | Cybersecurity duties for commercial systems derive from Law 116/2025; Circular 05 ethical security measures are voluntary for private actors. | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl2-pta-human-rights` | Circular 05/2026/TT-BKHCN Art 3(2)(a) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Unconditional requirement to conduct human-rights impact review under Circular 05. | Voluntary for private commercial operators under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl2-ptb-fairness` | Circular 05/2026/TT-BKHCN Art 3(2)(b) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Unconditional duty to measure and mitigate bias for vulnerable groups. | Voluntary ethical guideline for private commercial services under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl2-ptc-transparency` | Circular 05/2026/TT-BKHCN Art 3(2)(c) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates detailed notices on objectives, data, limitations under Circular 05. | Law 134 Art 11(1) already governs statutory conversational transparency. Circular 05 provisions are voluntary recommendations for private operators. | Circular 05 Art 1(2), 1(3); Law 134 Art 11(1). | **CONFIRMED** | Correct Circular 05 scope condition. |
| `art3-cl2-ptd-explainability` | Circular 05/2026/TT-BKHCN Art 3(2)(d) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates preparation of design/training/testing explanatory documents for private systems. | Voluntary ethical framework under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl3-pta-social-benefit` | Circular 05/2026/TT-BKHCN Art 3(3)(a) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Unconditional duty to assess public benefit and mitigate negative community impacts before deployment. | Applies mandatorily only to systems serving state management or public service delivery. | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl3-ptb-inclusive-design` | Circular 05/2026/TT-BKHCN Art 3(3)(b) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates interface design narrowing regional digital divide for private commercial software. | Voluntary guideline under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl3-ptc-sustainability` | Circular 05/2026/TT-BKHCN Art 3(3)(c) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates environmental and energy consumption lifecycle accounting for all software. | Voluntary guideline under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl3-ptd-cultural-values` | Circular 05/2026/TT-BKHCN Art 3(3)(d) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates design alignment with Vietnamese social ethical norms and cultural identity. | Ethical aspiration; voluntary for private commercial actors under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |
| `art3-cl3-ptd-discriminatory-content-prohibition` | Circular 05/2026/TT-BKHCN Art 3(3)(d) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Prohibition of discriminatory content under Circular 05. | Content prohibitions under Vietnamese law are established by Law 116 Art 8/13 and Penal Code; Circular 05 framing is an ethical standard. | Circular 05 Art 1(2), 1(3); Law 116 Art 8. | **CONFIRMED** | Harmonize with Law 116 source binding. |
| `art3-cl4-ptb-responsibility-allocation` | Circular 05/2026/TT-BKHCN Art 3(4)(b) | `Actor: Org/Indiv`<br>`Modality: DUTY`<br>`Applicability: UNCONDITIONAL` | Mandates designated complaint focal point and lifecycle responsibility allocation under Circular 05. | Voluntary ethical practice for private commercial systems under Art 1(3). | Circular 05 Art 1(2), 1(3). | **CONFIRMED** | Add public service / state management scope condition. |

---

## 3. Statutory & Structural Impact Analysis

### 3.1 Impact on T31 Assessment Posture
If these 16 confirmed legal defects in the Rule Set are corrected:
- **`luat134-art11-cl2-machine-readable-marking-impl` & `AR-art17-cl1-mark-ai-content`:**
  - Shift from `NON_COMPLIANT` to **`NOT_APPLICABLE`** for text-only systems.
  - Net impact: -2 non-compliant findings.
- **Circular 05/2026/TT-BKHCN (15 rules):**
  - For a private commercial enterprise (SYN Support Services) operating an Upwork IT consulting FAQ assistant, all 15 rules become **`NOT_APPLICABLE`** (or `RECOMMENDED / OUT_OF_SCOPE`).
  - Net impact: -15 non-compliant findings.
- **Combined Impact on T31 Non-Compliant Count:**
  - Current v2.0 non-compliant findings: 77 rules.
  - True statutory non-compliant findings under correct legal interpretation: **60 rules**.
  - All 60 remaining non-compliant findings represent genuine, enforceable statutory violations under **Law 91/2025/QH15** (28 rules), **Law 116/2025/QH15** (15 rules), **Decree 356/2025/NĐ-CP** (11 rules), **Decree 142/2026/NĐ-CP** (4 rules), and **Law 134/2025/QH15** (2 rules).

### 3.2 Architectural Neutrality Invariant
In accordance with LCSP's architecture rules:
- **No Vietnamese statutory logic was hardcoded into the generic DeepAgents Root Agent or NestJS application code.**
- The corrections exist purely in the **data layer** (the declarative propositions, applicability conditions, and exception trees of `AssessmentRule` and `LegalRequirement`).
- The generic reasoning engine remains fully legal-instrument agnostic.

---

## 4. Formal Review Conclusion & Certification Gate

### Exit Gate Verdict: **PARTIAL (LEGAL_REVIEW_PENDING)**
- **Investigated & Grounded:** Discrepancies have been traced directly to the statutory text of Law 134, Decree 142, and Circular 05.
- **Rule Set Immutability Preserved:** Legacy pinned Rule Set `97004ff3-9240-4e37-8a94-9ade8832c00a` has **not** been mutated or overwritten.
- **Requirement for Certified Reassessment:** Activating a successor Rule Set (`v1.p2` or `v2.0`) and using it for a certified benchmark reassessment requires **formal independent legal approval** from qualified legal counsel. Antigravity cannot certify legal interpretations without qualified human sign-off.
- **Gate Enforcement:** In accordance with the execution protocol, **Phase 3 controlled reassessment is held pending legal sign-off** on the proposed Rule Set corrections, preventing premature or invalid benchmark runs.

---

## 5. Phase 2.5: Candidate Rule Set Specification & Verification

Under Option 2 ("phương án 2 đi"), the Candidate Rule Set has been prepared and authored following LCSP's formal preparation specifications:

### 5.1 Candidate Profile
- **Candidate Identifier:** `lcsp-360-official-eight-document-acceptance-corpus.v2.candidate-p1`
- **Predecessor Rule Set Authority:** `97004ff3-9240-4e37-8a94-9ade8832c00a` (`v1.p1`, 243 active rules)
- **Legal Source Version Pinned:** `ea43540c-513e-4b76-969a-8415f06696f2`
- **Candidate Artifact Location:** [`docs/implementation-artifacts/candidate-rule-set-v2-legal-review-pending.json`](file:///Users/nguyenanh/Documents/Capstone/LCSP/docs/implementation-artifacts/candidate-rule-set-v2-legal-review-pending.json)
- **Governance State:** `LEGAL_REVIEW_PENDING` (Persisted as candidate artifact; NOT activated in production PostgreSQL database to ensure historical immutability).

### 5.2 Corrected Rule Specifications
| Target ID | Statutory Source | Candidate Applicability Mode | Candidate Conditions | Candidate Exceptions |
|---|---|---|---|---|
| `luat134-art11-cl2-machine-readable-marking` | Law 134/2025/QH15 Art 11(2) | `CONDITIONAL` | `[Hệ thống trí tuệ nhân tạo tạo ra nội dung đầu ra là âm thanh, hình ảnh hoặc video.]` | `[Không bắt buộc thực hiện đánh dấu kỹ thuật ở định dạng máy đọc đối với nội dung đầu ra là văn bản theo quy định tại khoản 1 Điều 17 Nghị định 142/2026/NĐ-CP, trừ trường hợp pháp luật có quy định khác.]` |
| `art17-cl1-mark-ai-content` | Decree 142/2026/NĐ-CP Art 17(1) | `CONDITIONAL` | `[Hệ thống trí tuệ nhân tạo tạo ra nội dung đầu ra là âm thanh, hình ảnh hoặc video.]` | `[Nhà cung cấp không bắt buộc phải thực hiện đánh dấu kỹ thuật ở định dạng máy đọc đối với nội dung đầu ra là văn bản...]` |
| Circular 05/2026/TT-BKHCN (15 rules: `art3-cl1-pta` through `art3-cl4-ptd`) | Circular 05/2026/TT-BKHCN Art 1(2), 1(3) & Art 3 | `CONDITIONAL` | `[Hệ thống trí tuệ nhân tạo phục vụ hoạt động quản lý nhà nước hoặc cung cấp dịch vụ công (khoản 2 Điều 1 Thông tư số 05/2026/TT-BKHCN)....]` | `[Tổ chức, cá nhân khác chỉ được khuyến khích áp dụng và không chịu nghĩa vụ bắt buộc cưỡng chế (khoản 3 Điều 1 Thông tư số 05/2026/TT-BKHCN)....]` |

### 5.3 Candidate Mechanical Integrity
- Verified against `complianceRuleSetPacketSchema` and `validateComplianceRuleSetPacket`.
- Schema conformity: PASSED.
- Citation & Hash parity with pinned Legal Source `ea43540c-513e-4b76-969a-8415f06696f2`: PASSED.
- Applicability condition syntax (`declaresApplicabilityScope`): PASSED.

