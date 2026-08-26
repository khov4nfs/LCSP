---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'domain'
research_topic: 'Wizard benchmark châu Âu cho LCSP'
research_goals: 'nghiên cứu benchmark từ các hệ thống/khung tự đánh giá kiểu châu Âu, ưu tiên AI Act/GDPR-style compliance flows; rút ra cấu trúc form Wizard phù hợp cho LCSP; từ đó chốt đề bài UX cho Wizard của Epic 2'
user_name: 'lcsp-team'
date: '2026-06-26'
web_research_enabled: true
source_verification: true
---

# Wizard Benchmark Châu Âu Cho LCSP: Comprehensive Domain Research

**Date:** 2026-06-26
**Author:** lcsp-team
**Research Type:** domain

---

## Executive Summary

Research này xác nhận rằng benchmark tốt nhất cho Wizard của LCSP không nằm ở một “vendor market leader” duy nhất, mà nằm ở giao điểm của 4 nguồn giá trị:
- **AI Act / EU authority** cho risk model và obligation framing
- **CNIL PIA / ICO framework** cho guided assessment và actionability
- **ALTAI / Walters / TAI Scan** cho question architecture
- **LCSP active authority** cho evidence chain, readiness-only positioning, và Manager-first flow

Kết luận chính:
- LCSP nên xây Wizard như **compliance navigation layer** chứ không phải legal chatbot hay final risk engine.
- Mô hình đúng nhất là **2 tầng**:
  - `pre-screen / scoping`
  - `business/legal structured intake`
- Output của Wizard phải là **readiness-only + next steps**, không hiển thị final legal/risk conclusion khi chưa có technical evidence và reconciliation.
- Về UX, form cần dùng **business/legal language**, **progressive disclosure**, **contextual help**, **structured mapping**, và **audit/versioning**.

**Key Findings:**
- AI Act rollout đang tạo nhu cầu thật cho self-assessment tooling theo risk-based approach.
- CNIL PIA là benchmark mạnh nhất cho didactic, modular, knowledge-backed assessment flow.
- TAI Scan củng cố pattern `pre-screening -> assessment`, rất phù hợp với LCSP.
- Dữ liệu thị phần cho phân khúc riêng “AI compliance Wizard” chưa đủ sạch; vì vậy product decisions nên bám authority/pattern hơn là bám vendor ranking.

**Strategic Recommendations:**
- Freeze một **canonical core Wizard** cho Epic 2 trước khi làm scenario overlays.
- Giao Auth stream cho Nhi như một module riêng; không để Wizard implementation chờ Auth ngoài các seam đã có.
- Chốt ngay **Wizard UX brief + question-to-field mapping table** trước khi mở dev cho Story 2.2.

## Table of Contents

1. Research Overview
2. Domain Research Scope Confirmation
3. Industry Analysis
4. Competitive Landscape
5. Regulatory Requirements
6. Technical Trends and Innovation
7. Strategic Insights and Domain Opportunities
8. LCSP Wizard UX Brief
9. Implementation Considerations and Team Recommendations
10. Research Methodology and Source Verification
11. Research Conclusion

## Research Overview

Research này tập trung vào benchmark Wizard/compliance intake theo phong cách châu Âu để làm đầu vào cho LCSP. Trọng tâm không phải là “thị trường SaaS compliance” nói chung, mà là các pattern đáng học cho một `guided questionnaire` phục vụ AI Act / GDPR-style self-assessment, readiness gating và evidence-based compliance.

---

## Domain Research Scope Confirmation

**Research Topic:** Wizard benchmark châu Âu cho LCSP
**Research Goals:** nghiên cứu benchmark từ các hệ thống/khung tự đánh giá kiểu châu Âu, ưu tiên AI Act/GDPR-style compliance flows; rút ra cấu trúc form Wizard phù hợp cho LCSP; từ đó chốt đề bài UX cho Wizard của Epic 2

**Domain Research Scope:**

- Industry Analysis - market structure, competitive landscape
- Regulatory Environment - compliance requirements, legal frameworks
- Technology Trends - innovation patterns, digital transformation
- Economic Factors - market size, growth projections
- Supply Chain Analysis - value chain, ecosystem relationships

**Research Methodology:**

- All claims verified against current public sources
- Multi-source validation for critical domain claims
- Confidence level framework for uncertain information
- Comprehensive domain coverage with industry-specific insights

**Scope Confirmed:** 2026-06-26

## Industry Analysis

### Market Size and Valuation

Phân khúc “European AI compliance wizard / self-assessment tooling” hiện chưa có một nguồn công khai authoritative đưa ra tổng dung lượng thị trường riêng biệt đủ tin cậy để dùng như con số chuẩn. Độ chín thị trường hiện tốt hơn nếu nhìn như một **emerging compliance workflow segment** nằm giao nhau giữa AI governance, privacy tooling, audit/compliance software và guided self-assessment products.

Ở tầng cầu thị trường, nhu cầu là có thật và đang tăng vì quy mô áp dụng của AI Act là rất rộng: Ủy ban Châu Âu mô tả đây là khung pháp lý AI toàn diện đầu tiên, áp dụng cách tiếp cận risk-based cho cả developers và deployers, đồng thời đi kèm AI Pact và AI Act Service Desk để hỗ trợ implementation. Điều này cho thấy nhu cầu tooling không còn là tùy chọn “nice to have”, mà gắn trực tiếp với việc tổ chức cần tự phân loại use case, hiểu nghĩa vụ, và chứng minh readiness theo giai đoạn.  
_Total Market Size: chưa có số TAM công khai đáng tin cậy riêng cho phân khúc Wizard AI compliance ở châu Âu; nên dùng proxy, không dùng một con số tuyệt đối_  
_Growth Rate: độ tin cậy định lượng thấp; nhưng độ tin cậy định tính cao rằng nhu cầu tăng theo các mốc áp dụng của AI Act_  
_Market Segments: regulatory guidance tools, privacy impact tools, AI self-assessment tools, enterprise governance/compliance platforms_  
_Economic Impact: demand chủ yếu đến từ chi phí tuân thủ, internal governance, auditability, và giảm chi phí hỏi luật/compliance lặp lại_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://eur-lex.europa.eu/eli/reg/2024/1689/oj ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Market Dynamics and Growth

Động lực tăng trưởng chính của phân khúc này đến từ **regulatory activation timeline**, không chỉ từ hype AI. Theo trang AI Act của Ủy ban Châu Âu, AI Act có hiệu lực từ **1 August 2024**, các cấm đoán đối với prohibited practices bắt đầu áp dụng từ **2 February 2025**, nghĩa vụ GPAI từ **2 August 2025**, và các quy tắc transparency từ **August 2026**; ngoài ra các mốc high-risk tiếp tục được chi tiết hóa qua lộ trình implementation hiện hành. Điều đó tạo ra nhu cầu mạnh cho các tool kiểu Wizard ở 3 thời điểm: pre-screening, scope clarification, và readiness preparation trước high-risk enforcement.

Nghiên cứu “Complying with the EU AI Act” cho thấy khoảng trống readiness là thực: 15 tổ chức khảo sát có **điểm compliance trung bình 57%**, với các điểm yếu rõ ở technical documentation và user communication. Đây là tín hiệu trực tiếp rằng thị trường không chỉ cần dashboard compliance, mà cần **guided intake** giúp business users trả lời đúng và đủ. Bài “TAI Scan Tool” năm 2025 cũng xác nhận động lực này ở SMEs/startups: thiếu nguồn lực pháp lý và đạo đức nội bộ, nên cần một luồng assessment có đầu vào tối giản nhưng vẫn dẫn về nghĩa vụ phù hợp.  
_Growth Drivers: AI Act rollout theo giai đoạn; nhu cầu self-assessment sớm; SMEs thiếu chuyên môn compliance; yêu cầu trust/fundamental-rights governance_  
_Growth Barriers: nghĩa vụ pháp lý phức tạp; thay đổi timeline; thiếu dữ liệu benchmark chuẩn; khó biến luật thành form dễ điền_  
_Cyclical Patterns: nhu cầu tăng theo các mốc pháp lý và các giai đoạn procurement / audit / policy rollout_  
_Market Maturity: early-to-mid emerging segment; regulatory urgency cao nhưng product standardization còn thấp_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Market Structure and Segmentation

Thị trường benchmark liên quan Wizard ở châu Âu hiện chia thành 4 archetype rõ rệt.

Thứ nhất là **official regulatory scaffolds**: AI Act legal text, European Commission AI Act guidance, và các support instruments của AI Office. Nhóm này không phải product form hoàn chỉnh, nhưng định hình ngôn ngữ, risk model và evidence expectations.

Thứ hai là **privacy / impact assessment tools**. CNIL PIA là mẫu rất mạnh cho một Wizard compliance đúng chất châu Âu: didactic interface, step-by-step flow, legal + technical knowledge base, và khả năng modular/customize theo ngành. ICO audit framework lại mạnh ở self-assessment / audit tracker / control-measure model, nhấn mạnh rằng compliance không phải tick-box và cần judgement theo risk.

Thứ ba là **AI self-assessment / research prototypes** như ALTAI, questionnaire của nghiên cứu Walters et al., và TAI Scan Tool. Nhóm này không mạnh về enterprise workflow hoàn chỉnh, nhưng rất có giá trị cho `question architecture`: pre-screening trước, assessment sau; nhóm câu hỏi theo lĩnh vực nghĩa vụ; scoring / confidence / reflection; và output dẫn người dùng tới obligation tiếp theo.

Thứ tư là **enterprise governance platforms**. Nhóm này hiện diện trên thị trường nhưng khó dùng làm authority chính cho LCSP vì nhiều sản phẩm đóng, thiên dashboard/control library hơn là business-language Wizard kiểu Manager-first.

_Primary Segments: official guidance; privacy impact tooling; AI self-assessment tooling; enterprise governance/compliance platforms_  
_Sub-segment Analysis: pre-screening tools, readiness questionnaires, audit frameworks, evidence trackers, risk-classification assistants_  
_Geographic Distribution: EU-level guidance tập trung ở European Commission / Parliament; privacy impact patterns mạnh từ CNIL và ICO_  
_Vertical Integration: regulatory text -> guidance/service desk -> assessment wizard -> audit/export tracker -> downstream governance workflow_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2103.09051 ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Industry Trends and Evolution

Có 5 pattern đang lặp lại xuyên suốt các benchmark đáng học.

1. **Risk-based entry thay vì full legal questionnaire ngay từ đầu.** European Commission mô tả AI Act bằng tháp risk-based; TAI Scan cụ thể hóa thành mô hình hai bước: pre-screening trước, assessment sau. Đây là pattern rất phù hợp với LCSP.

2. **Business user không nên phải đọc luật thô.** CNIL PIA nhấn vào didactic interface và knowledge base theo ngữ cảnh; Walters et al. cho thấy technical documentation và user communication là nơi tổ chức yếu nhất. Nghĩa là Wizard tốt phải “dịch luật” thành câu hỏi nghiệp vụ.

3. **No one-size-fits-all.** ICO nói rõ framework chỉ là điểm khởi đầu và không có one-size-fits-all; CNIL cũng cho phép modularize / duplicate model theo sector. LCSP vì vậy nên thiết kế `canonical core + sector overlays`, không cố làm một bộ câu hỏi phẳng cho mọi case.

4. **Output phải dẫn hành động tiếp theo, không chỉ chấm điểm.** ICO có audit trackers; TAI Scan trả về risk-level + relevant articles; AI Act Service Desk được tạo để hỗ trợ triển khai. Pattern chung là output phải gắn với “what next”.

5. **Traceability và human oversight đang trở thành first-class expectation.** AI Act nhấn mạnh logging, documentation, human oversight, transparency; Parliament cũng gắn quyền khiếu nại và meaningful explanations với high-risk AI. Điều này ủng hộ hướng LCSP dùng Wizard như nguồn “business/legal truth” có versioning và audit trail, chứ không chỉ là UX form.

_Emerging Trends: two-step assessment, contextual knowledge base, modular questionnaire, action-oriented output, evidence traceability_  
_Historical Evolution: từ privacy impact / audit frameworks sang AI-specific readiness and obligation mapping_  
_Technology Integration: RAG / knowledge-grounded guidance xuất hiện để giảm chi phí bảo trì rule engine và giúp cập nhật theo regulatory change_  
_Future Outlook: phân khúc sẽ dịch từ static questionnaire sang guided workbench có service-desk, citations, export trackers và sector profiles_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Competitive Dynamics

Đây là một thị trường **fragmented** và còn thiếu chuẩn sản phẩm thống nhất. Regulatory bodies cung cấp framework và support instruments, nhưng hiếm khi cung cấp trọn vẹn một Manager-facing product flow đủ tốt cho implementation team dùng ngay. Nghiên cứu học thuật thì giàu ý tưởng về questionnaire/scoring, nhưng thường yếu về production UX, state machine, và permission model. Enterprise compliance vendors thì mạnh về workflow/audit, nhưng thường nặng, đóng, và không tối ưu cho “Manager có thể tự hoàn tất Wizard bằng business/legal language”.

Rào cản gia nhập không nằm chủ yếu ở UI form, mà ở 4 thứ: cập nhật luật liên tục, chuyển nghĩa vụ thành câu hỏi đúng ngữ cảnh, map answer sang structured fields downstream, và giữ traceability/auditability. Đây cũng chính là lý do LCSP có cơ hội khác biệt: nếu Wizard được thiết kế như **front-door của evidence-based compliance workflow**, nó sẽ mạnh hơn các questionnaire rời rạc.

_Market Concentration: thấp đến trung bình; nhiều framework/pattern nhưng ít chuẩn thống trị cho AI compliance Wizard ở châu Âu_  
_Competitive Intensity: tăng dần theo AI Act rollout, đặc biệt ở vùng AI governance + privacy + regtech overlap_  
_Barriers to Entry: legal interpretation upkeep, knowledge-base maintenance, downstream evidence mapping, localization, audit/export design_  
_Innovation Pressure: cao; vendor và research đều đang thử pre-screening, minimal-input assessment, knowledge-grounded guidance, and compliance trackers_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514 ; https://arxiv.org/abs/2103.09051_

## Competitive Landscape

### Key Players and Market Leaders

Nếu xét đúng phân khúc “Wizard benchmark châu Âu cho AI/GDPR-style self-assessment”, các “key players” hiện không phải toàn bộ là công ty thương mại. Bức tranh thực tế chia thành ba nhóm dẫn dắt:

1. **Public-regulatory leaders**
   - **European Commission / AI Office / AI Act Service Desk**: dẫn dắt về normative framing, implementation support, risk model, timeline, và compliance expectations cho AI Act.
   - **European Parliament / EUR-Lex**: không phải product competitor, nhưng là authority gốc quyết định mọi benchmark đúng-sai.

2. **Public assessment-pattern leaders**
   - **CNIL PIA**: benchmark mạnh nhất cho privacy-style guided impact assessment có workflow, knowledge base, exportable reasoning và modularization.
   - **ICO Data Protection Audit Framework**: benchmark mạnh cho self-audit/checklist/control-measure model, đặc biệt ở phần actionability và expectation-setting.

3. **AI-assessment thought leaders / prototype leaders**
   - **ALTAI**: khung trustworthy-AI assessment có sức ảnh hưởng về cấu trúc đánh giá.
   - **Walters et al. questionnaire**: benchmark tốt cho AIA readiness questionnaire.
   - **TAI Scan Tool**: benchmark mới cho minimal-input, pre-screening + assessment, AI-Act-grounded flow.

Với LCSP, các nhóm trên quan trọng hơn “enterprise software market leaders” vì chúng gần bài toán **Manager-facing compliance wizard** hơn.  
_Market Leaders: European Commission / AI Office ở vai trò framework leader; CNIL PIA và ICO framework ở vai trò assessment-pattern leaders; ALTAI / TAI Scan / AIA questionnaire ở vai trò concept leaders_  
_Major Competitors: CNIL PIA, ICO audit framework, TAI Scan, ALTAI-derived assessments, AI Act Service Desk guidance surfaces_  
_Emerging Players: AI-specific compliance assistants và governance platforms đang tận dụng AI Act rollout để mở rộng_  
_Global vs Regional: authority và benchmark cốt lõi mang tính châu Âu rõ rệt; commercial platform vendors có xu hướng toàn cầu nhưng localize theo EU rules_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2103.09051 ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Market Share and Competitive Positioning

Không có dữ liệu market share authoritative đủ tốt cho riêng phân khúc này. Vì vậy, competitive positioning nên đọc theo “quyền lực định hình hành vi người dùng” hơn là theo doanh thu.

- **European Commission / AI Office** có vị thế mạnh nhất về **regulatory authority** và ability to set the vocabulary of compliance.
- **CNIL PIA** mạnh ở **workflow usability + educational scaffolding** cho impact assessment.
- **ICO framework** mạnh ở **control-measure assessment + audit framing**.
- **ALTAI / Walters / TAI Scan** mạnh ở **question architecture** và translation từ law/ethics thành assessment logic.
- **Commercial governance platforms** mạnh ở integration, workflow management, evidence repository, nhưng yếu hơn trong việc làm “business/legal language Wizard” đúng tinh thần Manager-first của LCSP nếu không được custom mạnh.

Nói cách khác, LCSP không nên định vị mình như một “general AI governance dashboard”. Nó nên định vị như **evidence-based compliance workbench với Wizard làm front door**.  
_Market Share Distribution: chưa có phân bổ thị phần công khai đáng tin cậy cho phân khúc riêng này_  
_Competitive Positioning: public bodies chi phối luật chơi; public frameworks chi phối pattern đánh giá; research prototypes chi phối question design; vendors chi phối enterprise workflow/integration_  
_Value Proposition Mapping: authority, didactic guidance, assessment structure, actionability, enterprise workflow là 5 lớp giá trị khác nhau_  
_Customer Segments Served: regulators/guidance seekers, privacy teams, SMEs/startups, enterprise risk/compliance teams, internal legal/governance teams_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Competitive Strategies and Differentiation

Ba chiến lược cạnh tranh nổi bật trong không gian này là:

1. **Authority-first**
   - Điển hình: European Commission / AI Office / Parliament.
   - Lợi thế: người dùng tin vì đó là nguồn nghĩa vụ và timeline chính thức.
   - Điểm yếu: không phải lúc nào cũng đưa ra UX flow đủ sâu để dev team build product trực tiếp.

2. **Didactic workflow-first**
   - Điển hình: CNIL PIA.
   - Lợi thế: biến khung pháp lý thành luồng đánh giá có thể thao tác, có hỗ trợ giải thích.
   - Điểm yếu: thường neo vào privacy impact, không trực tiếp bao quát AI evidence chain như LCSP cần.

3. **Minimal-input assessment-first**
   - Điển hình: TAI Scan Tool và các questionnaire research-driven.
   - Lợi thế: giảm friction ban đầu, phù hợp SMEs.
   - Điểm yếu: dễ thiếu chiều sâu nếu không có downstream evidence/reconciliation chain.

ICO framework đứng giữa didactic và audit-control style: ít “wizardy” hơn CNIL nhưng mạnh hơn về governance control mapping.  
_Cost Leadership Strategies: không nổi bật; phần lớn benchmark cạnh tranh bằng trust và usability, không phải giá rẻ_  
_Differentiation Strategies: authority, didactic guidance, modularization, minimal input, auditability, citations_  
_Focus/Niche Strategies: privacy assessment, AI readiness, audit self-assessment, GPAI obligations, sector-specific trustworthiness_  
_Innovation Approaches: knowledge-base guidance, pre-screening, structured questionnaires, compliance service desks, voluntary codes/practical toolkits_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2507.17514 ; https://arxiv.org/abs/2307.10458_

### Business Models and Value Propositions

Ở competitive set này có hai business model khác nhau rõ rệt.

- **Public/non-commercial model**:
  - Commission guidance, AI Office support, CNIL PIA, ICO framework.
  - Giá trị chính: tạo chuẩn, giảm mơ hồ, hướng dẫn self-assessment, tăng khả năng chứng minh compliance process.

- **Commercial platform model**:
  - Enterprise governance/compliance vendors.
  - Giá trị chính: tích hợp inventory, workflow, evidence, audit, reporting, policy automation.

LCSP không nên sao chép nguyên một trong hai. Mô hình đúng hơn là:
- lấy **authority and trust semantics** từ public model
- lấy **workflow, versioning, and operational handoff** từ commercial model
- nhưng giữ **Manager-first business-language intake** như điểm khác biệt trung tâm.

_Primary Business Models: public guidance tools; open assessment utilities; commercial GRC / AI-governance platforms_  
_Revenue Streams: public benchmarks không bán license; commercial vendors bán subscription, workflow automation, governance modules, enterprise support_  
_Value Chain Integration: public actors định nghĩa rule/guidance; product vendors operationalize; end-users tích hợp vào governance workflow nội bộ_  
_Customer Relationship Models: public trust / self-service support vs enterprise contract / implementation-led adoption_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/_

### Competitive Dynamics and Entry Barriers

Competitive pressure lớn nhất không đến từ “nhiều form tương tự”, mà từ việc người dùng có thể giải quyết một phần nhu cầu bằng:
- guidance text chính thức,
- privacy frameworks sẵn có,
- internal legal questionnaires,
- hoặc generic GRC platforms.

Vì vậy LCSP chỉ thắng nếu Wizard không dừng ở intake, mà nối liền tới downstream artifacts như `WizardProfile`, readiness-only outputs, technical evidence gates, reconciliation và final evidence chain.

Rào cản gia nhập mạnh nhất của phân khúc gồm:
- regulatory interpretation upkeep,
- localization theo ngôn ngữ/ngữ cảnh pháp lý,
- ontology/mapping từ câu hỏi sang structured fields,
- auditability và explainability,
- tránh biến công cụ thành “fake legal certainty machine”.

_Barriers to Entry: legal interpretation upkeep, structured mapping design, evidence-chain integration, localization, trust and audit expectations_  
_Competitive Intensity: trung bình nhưng tăng nhanh; cạnh tranh diễn ra nhiều ở framing và trust hơn là ở UI skin_  
_Market Consolidation Trends: chưa thấy chuẩn thống trị ở phân khúc Wizard AI compliance châu Âu; thị trường còn phân mảnh giữa public frameworks, research tools, và vendors_  
_Switching Costs: thấp nếu chỉ là questionnaire rời; cao hơn nhiều khi tool gắn với audit trail, workflow state, evidence mapping và document generation_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514 ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment_

### Ecosystem and Partnership Analysis

Ecosystem này được dẫn bởi một value chain khá rõ:

1. **Law / rule-setting**
   - AI Act, Parliament, Commission, AI Office, national DPAs.
2. **Interpretation / guidance**
   - service desk, guidelines, codes of practice, DPA frameworks.
3. **Assessment tooling**
   - PIA tools, self-assessment questionnaires, AI readiness assistants.
4. **Operational governance platforms**
   - enterprise AI governance / GRC / audit tools.
5. **Delivery / assurance layer**
   - legal, compliance, risk, security, product, and engineering teams.

LCSP nằm ở giao điểm giữa lớp 3 và lớp 4, nhưng với downstream chain sâu hơn nhiều nhờ technical evidence + reconciliation + legal matching. Đây là lợi thế kiến trúc mà benchmark hiện có thường không sở hữu cùng lúc.

_Supplier Relationships: nguồn authority đến từ EU institutions và DPA guidance; nguồn pattern đến từ research / audit frameworks_  
_Distribution Channels: public self-service web guidance, open-source utilities, enterprise platform sales, compliance consulting_  
_Technology Partnerships: xu hướng cần knowledge-base integration, workflow orchestration, evidence storage, audit/export surfaces_  
_Ecosystem Control: EU institutions kiểm soát luật chơi; product teams thắng ở operationalization và end-to-end workflow quality_  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/_

## Regulatory Requirements

### Applicable Regulations

Khung pháp lý cốt lõi chi phối Wizard benchmark của LCSP ở châu Âu là **AI Act + GDPR**, với AI Act là regulatory driver chính cho bài toán AI-system compliance và GDPR là lớp privacy-impact / personal-data handling bắt buộc khi Wizard thu thập hoặc suy diễn thông tin có thể chạm dữ liệu cá nhân.

Về AI Act, Ủy ban Châu Âu mô tả đây là khung pháp lý AI toàn diện đầu tiên trên thế giới, dùng cách tiếp cận **risk-based** và đặt nghĩa vụ khác nhau theo mức rủi ro. Trang chính thức của Commission liệt kê rõ 4 tầng risk, cùng các nghĩa vụ mạnh đối với high-risk systems: risk assessment and mitigation, dataset quality, logging, documentation, deployer information, human oversight, robustness/cybersecurity/accuracy. Điều này có nghĩa một Wizard chuẩn không thể chỉ hỏi “có dùng AI không”; nó phải hỏi đủ để:
- xác định có đụng prohibited / high-risk / transparency-relevant patterns không,
- gom context đủ cho obligation routing,
- nhưng chưa được giả vờ hoàn thành compliance assessment đầy đủ khi chưa có evidence chain.

Về GDPR, Regulation (EU) 2016/679 nêu tại Article 35 rằng **Data Protection Impact Assessment** là bắt buộc khi processing có khả năng gây high risk cho quyền và tự do của data subjects; recital liên quan cũng nhấn mạnh impact assessment phải đánh giá likelihood/severity của risk và các safeguards/mitigations. Điều này làm cho benchmark CNIL PIA đặc biệt quan trọng: nó cung cấp pattern hợp pháp hóa việc hỏi theo dạng impact/risk/context thay vì chỉ hỏi checklist phẳng.  
_Sources: https://eur-lex.europa.eu/eli/reg/2024/1689/oj ; https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://eur-lex.europa.eu/eli/reg/2016/679/oj_

### Industry Standards and Best Practices

Hiện chưa có một “single official standard” cho Wizard AI compliance UX ở châu Âu, nhưng có một tập thực hành tốt khá rõ:

- **Risk-based scoping first**: bắt đầu bằng prohibited/high-risk/transparency scoping thay vì full-form ngay.
- **Business-language intake**: câu hỏi phải dịch nghĩa vụ pháp lý thành business/legal language.
- **Human oversight and traceability by design**: logging, explanations, and documented reasoning phải hiện diện từ thiết kế intake.
- **Modularization**: form cần có core model và khả năng thêm sector overlays.
- **Actionable output**: output phải chỉ ra next steps, not just score.

CNIL PIA là một best-practice nổi bật vì mô hình hóa ba thành phần cực có ích cho LCSP:
1. didactic interface,
2. legal + technical knowledge base,
3. modular tool có thể duplicate/customize theo business sector.

ICO framework bổ sung một thực hành tốt khác: self-assessment nên gắn với **control measures** và các cách “meet expectations”, không khóa người dùng vào một cách thực hiện duy nhất.  
_Sources: https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai_

### Compliance Frameworks

Có ba compliance framework/pattern nên tác động trực tiếp đến thiết kế Wizard của LCSP.

1. **AI Act risk-based framework**
   - dùng để chia câu hỏi pre-screen theo prohibited / high-risk / transparency relevance.

2. **DPIA / PIA framework**
   - dùng để định hình cách hỏi về data subjects, data categories, purpose, impact, safeguards, human review, proportionality.

3. **Trustworthy-AI assessment framework**
   - ALTAI và các research derivatives cho thấy câu hỏi không nên chỉ về legal scope, mà còn cần context để sau này map sang human oversight, transparency, robustness, accountability.

AI Act Service Desk hiện đã có **AI Act Explorer**, **Compliance Checker**, **Timeline**, **FAQ**, và hướng dẫn high-risk. Đây là một tín hiệu thiết kế rất mạnh: người dùng cần một **interactive compliance navigation layer**, không chỉ PDF guidance. Với LCSP, điều này củng cố hướng xây Wizard như một `decision-support intake`, chứ không phải static form.  
_Sources: https://ai-act-service-desk.ec.europa.eu/en ; https://arxiv.org/abs/2103.09051 ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Data Protection and Privacy

Nếu LCSP Wizard hỏi về data type, user group, biometric use, high-impact use, human oversight, external LLM usage, thì Wizard đã chạm trực tiếp vùng privacy-sensitive và rights-sensitive. Vì vậy privacy không phải concern phụ, mà là lớp thiết kế đầu vào.

Các hệ quả thực tế:
- câu hỏi phải phân biệt dữ liệu thường / personal data / special categories / biometric data ở mức business-friendly;
- nếu người dùng mô tả processing có khả năng high risk, hệ thống phải có khả năng route sang privacy-style caution / later DPIA-oriented handling;
- Wizard không được ép người dùng công bố technical secrets, nhưng vẫn phải thu đủ ngữ cảnh cho risk and impact triage;
- answer history, drafts, and profile versions cần được quản trị như compliance-sensitive records.

GDPR Article 35 và recital liên quan ủng hộ rõ cách tiếp cận “impact before processing / risk before deployment”. CNIL PIA cho thấy pattern triển khai hiệu quả là gắn legal basis + contextual knowledge base xuyên suốt luồng thay vì gom tất cả cảnh báo vào cuối form.  
_Sources: https://eur-lex.europa.eu/eli/reg/2016/679/oj ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment_

### Licensing and Certification

Không có yêu cầu chung rằng một Wizard kiểu LCSP phải trở thành công cụ được “licensed” hay “certified” mới được dùng. Tuy nhiên, có một rủi ro lớn về positioning:

- nếu sản phẩm biểu đạt như một **formal legal opinion**, **certification**, hoặc **regulator-approved conformity result**, thì kỳ vọng pháp lý và trách nhiệm sản phẩm sẽ tăng mạnh;
- trong khi benchmark public hiện tại chủ yếu là guidance, self-assessment, explorer, checker, impact assessment tool, chứ không phải certification engine.

Điều này phù hợp hoàn toàn với authority hiện tại của LCSP: platform hỗ trợ tuân thủ dựa trên bằng chứng, không phải công cụ cấp legal opinion hay compliance certification. Vì vậy Wizard UX phải cực kỳ rõ ràng ở nhãn output: readiness, indicators, obligations to explore, next steps, not “final regulatory status”.  
_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://www.europarl.europa.eu/news/en/press-room/20240308IPR19015/artificial-intelligence-act-meps-adopt-landmark-law ; https://ai-act-service-desk.ec.europa.eu/en_

### Implementation Considerations

Từ góc nhìn triển khai Wizard cho LCSP, regulatory analysis dẫn tới các quyết định thiết kế rất cụ thể:

1. **Bắt buộc có pre-screen section**
   - để phát hiện prohibited/high-risk/transparency-relevant indicators sớm.

2. **Không hiển thị risk level cuối cùng ở Wizard-only stage**
   - vì AI Act obligations đòi documentation, logging, human oversight, dataset quality và các control khác trước khi có kết luận high-risk compliance thực sự.

3. **Bắt buộc có structured field mapping**
   - mỗi câu hỏi critical phải map vào `WizardProfile` field dùng được downstream.

4. **Bắt buộc có progressive disclosure**
   - nhất là ở human oversight, decision role, personal/sensitive data, biometric use, external LLM usage, and user impact.

5. **Bắt buộc có contextual help / knowledge-base snippets**
   - theo pattern CNIL PIA và AI Act Service Desk.

6. **Bắt buộc có output theo next-step semantics**
   - ví dụ: cần technical evidence, cần legal review, cần verify human oversight, cần inspect data categories.

7. **Bắt buộc giữ audit-safe history**
   - answers, drafts, submission state, correlation id, versioning.

_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://ai-act-service-desk.ec.europa.eu/en ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://eur-lex.europa.eu/eli/reg/2016/679/oj_

### Risk Assessment

Các regulatory risks lớn nhất nếu Wizard thiết kế sai:

- **Overclaim risk**: Wizard tạo cảm giác “đã phân loại pháp lý xong” khi thực tế mới chỉ có self-declared input.
- **Under-capture risk**: câu hỏi quá ít nên thiếu context cho high-risk/prohibited/transparency routing.
- **Jargon risk**: câu hỏi quá kỹ thuật khiến Manager không thể tự hoàn tất golden path.
- **Privacy risk**: hỏi dữ liệu nhạy cảm mà không có framing/need/handling phù hợp.
- **Traceability risk**: không lưu version + rationale đủ để giải thích vì sao downstream flow bị block hay chuyển hướng.
- **Localization risk**: dịch literal từ legal text sang tiếng Việt nhưng không chuyển thành business/legal language có thể trả lời được.

Kết luận regulatory của bước này là:
- **Wizard phải là compliance navigation layer**, không phải final compliance engine.
- **Pre-screen + business/legal structured intake + readiness-only output** là mô hình an toàn nhất cho LCSP.
- Đây cũng là mô hình phù hợp nhất với authority docs hiện tại của repo.

## Technical Trends and Innovation

### Emerging Technologies

Xu hướng kỹ thuật nổi bật nhất trong không gian này không phải là “AI để trả lời mọi thứ”, mà là **interactive compliance navigation** kết hợp knowledge grounding. European Commission đã không chỉ phát hành legal text; hệ sinh thái hỗ trợ rollout đang dịch dần sang các công cụ điều hướng như AI Act Service Desk, AI Act Explorer, timeline, FAQ, và checker-like experiences. Điều này cho thấy ngay cả ở tầng chính sách, hướng phát triển đang đi về phía **tool-assisted interpretation**, không chỉ static guidance.

Ở tầng nghiên cứu, “Knowledge-Augmented Reasoning for EUAIA Compliance...” nêu rõ một hướng kiến trúc đáng chú ý: compliance reasoning cần components có thể truy nguyên về source, kết hợp rules, assurance cases và contextual mappings thay vì chỉ suy luận tự do. Với LCSP, điều này ủng hộ một Wizard có:
- structured question model,
- contextual knowledge snippets,
- source-aware mapping xuống `WizardProfile`,
- và downstream explainability.

_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://arxiv.org/abs/2410.09078 ; https://arxiv.org/abs/2507.17514_

### Digital Transformation

Digital transformation của phân khúc này đang đi theo 3 hướng:

1. **Từ static document sang interactive checker**
   - AI Act support surfaces, PIA tools, audit frameworks và research prototypes đều đang đi theo mô hình có thể thao tác.

2. **Từ generic compliance portal sang workflow-specific workbench**
   - người dùng không cần một cổng thông tin chung; họ cần flow đúng thời điểm, đúng role, đúng next step.

3. **Từ questionnaire độc lập sang artifact chain**
   - câu trả lời không còn là đích cuối; nó trở thành input cho report, audit trail, conflict resolution, obligation routing, và evidence follow-up.

Đây chính xác là loại chuyển dịch mà LCSP đang phù hợp: Wizard không sống riêng, mà là đầu chuỗi cho `WizardProfile -> readiness -> evidence -> reconciliation -> legal matching`.  
_Sources: https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/ ; https://arxiv.org/abs/2307.10458 ; https://arxiv.org/abs/2507.17514_

### Innovation Patterns

Có 6 pattern đổi mới đáng lấy trực tiếp vào UX/solution design của LCSP.

1. **Two-phase assessment**
   - pre-screening trước, detailed assessment sau.

2. **Knowledge-base in context**
   - help text, examples, legal explanation ngắn và đúng chỗ.

3. **Progressive disclosure**
   - không ném mọi field khó lên cùng một màn hình.

4. **Structured explainability**
   - mỗi answer không chỉ lưu value, mà nên có provenance, version, rationale scope.

5. **Goal-aware outputs**
   - output đổi theo mục đích: readiness, next steps, missing evidence, blocked states.

6. **Modular overlays**
   - core questionnaire + scenario/sector packs, thay vì một form cứng cho mọi use case.

Nghiên cứu về explainability under the AI Act bổ sung một điểm quan trọng: explainability nên **risk-focused, goal-aware, intelligible and accessible**. Điều này áp vào Wizard có nghĩa: câu hỏi và output phải phù hợp trình độ Manager, không chỉ đúng logic luật.  
_Sources: https://arxiv.org/abs/2110.11168 ; https://arxiv.org/abs/2410.09078 ; https://arxiv.org/abs/2507.17514 ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment_

### Future Outlook

Trong 12-24 tháng tới, các tool kiểu này nhiều khả năng sẽ dịch theo 4 hướng:

- **nhiều interactive compliance helpers hơn** do AI Act đi vào các mốc áp dụng cụ thể;
- **nhiều sector-specific overlays hơn** vì one-size-fits-all sẽ lộ hạn chế nhanh;
- **nhiều source-grounded reasoning hơn** để giảm hallucination/legal overclaim;
- **nhiều audit/export expectations hơn** vì self-assessment ngày càng phải chứng minh được logic và history của nó.

LCSP không cần đợi thị trường ổn định rồi mới làm. Ngược lại, đây là lúc lợi thế nằm ở chỗ product có thể kết hợp:
- business-language Wizard,
- evidence chain,
- reconciliation,
- legal citation grounding,
- và Manager-first workflow.

_Sources: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai ; https://arxiv.org/abs/2410.09078 ; https://arxiv.org/abs/2507.17514 ; https://arxiv.org/abs/2307.10458_

### Implementation Opportunities

Từ góc nhìn product + UX, các cơ hội triển khai rõ nhất cho LCSP là:

1. **Wizard pre-screen card stack**
   - vài câu phân luồng sớm về use case, data sensitivity, affected people, decision significance, external LLM, biometric/high-impact indicators.

2. **Sectioned business/legal Wizard**
   - chia thành purpose, users, data, decisions, oversight, external AI/service-provider use, deployment context.

3. **Contextual explanation layer**
   - mỗi câu khó có inline “Vì sao câu này quan trọng?” và ví dụ nghiệp vụ.

4. **Readiness-only result**
   - trả ra missing-info, evidence next steps, blocked reasons, and follow-up actions.

5. **Scenario overlays**
   - ví dụ public chatbot, HR screening, credit/eligibility decision, internal productivity assistant.

6. **Structured answer-to-field contract**
   - mỗi câu hỏi có mapping ID, criticality, downstream uses, readiness implication, reconciliation implication.

_Sources: https://arxiv.org/abs/2507.17514 ; https://arxiv.org/abs/2307.10458 ; https://www.cnil.fr/en/open-source-pia-software-helps-carry-out-data-protection-impact-assessment ; https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/_

### Challenges and Risks

Các rủi ro kỹ thuật/UX nổi bật:

- **hallucinated legal guidance risk** nếu contextual help không source-grounded;
- **over-automation risk** nếu Wizard cố tự kết luận quá nhiều trước evidence stage;
- **form fatigue risk** nếu sectioning và progressive disclosure làm không tốt;
- **ontology drift risk** nếu question wording đổi nhưng field mapping downstream không cập nhật;
- **explainability debt** nếu save answer nhưng không giải thích được tại sao route sang next step nào;
- **localization debt** nếu benchmark EU được bê nguyên sang tiếng Việt mà không chuyển nghĩa cho business users Việt Nam.

_Sources: https://arxiv.org/abs/2410.09078 ; https://arxiv.org/abs/2110.11168 ; https://arxiv.org/abs/2307.10458_

## Recommendations

### Technology Adoption Strategy

- Dùng **source-grounded guidance snippets**, không dùng free-form legal assistant trong Wizard.
- Xây **question schema + mapping registry** trước khi dựng UI screens chi tiết.
- Thiết kế Wizard như **stateful workflow artifact**, không phải form tĩnh.
- Chuẩn bị sẵn path cho **scenario overlays**, nhưng chỉ freeze `canonical core` trước.

### Innovation Roadmap

1. Freeze `canonical core Wizard` cho Epic 2.
2. Tách rõ `pre-screen` và `detailed intake`.
3. Tạo `question-to-WizardProfile mapping table`.
4. Thiết kế `readiness-only result model`.
5. Bổ sung `scenario overlays` sau khi test core flow.
6. Chỉ sau đó mới tối ưu bằng richer knowledge assistance hoặc adaptive questioning.

### Risk Mitigation

- Mọi help text quan trọng phải có authority source.
- Mọi critical field phải có downstream owner và use.
- Không hiển thị final risk label ở Wizard-only stage.
- Có explicit copy cho `unknown / not sure`.
- Có audit/versioning cho draft, submit, và answer changes.

## Strategic Insights and Domain Opportunities

### Cross-Domain Synthesis

Khi ghép market, regulatory, benchmark và technical patterns lại với nhau, có 3 kết luận chiến lược rõ:

1. **LCSP không nên cạnh tranh bằng breadth**
   - Không cần trở thành general AI governance platform.
   - Nên thắng ở chỗ intake đúng, evidence chain đúng, và readiness semantics đúng.

2. **Wizard là artifact chiến lược, không phải UI phụ**
   - Nó tạo `WizardProfile`, ảnh hưởng readiness-only state, ảnh hưởng reconciliation, và ảnh hưởng legal matching downstream.

3. **Khác biệt thật sự của LCSP là evidence-based continuity**
   - Nhiều benchmark châu Âu mạnh ở assessment.
   - LCSP có cơ hội mạnh hơn vì nối assessment vào technical evidence, conflict resolution và legal citation chain.

### Strategic Opportunities

- Xây `canonical core Wizard` đủ tốt cho 3 scenario chuẩn:
  - public chatbot
  - HR screening / workforce decision support
  - credit / eligibility / consequential decision support
- Biến Wizard thành điểm nhập “business/legal truth” cho Manager mà không cần Developer tham gia.
- Dùng readiness-only result như một sản phẩm con có giá trị độc lập, ngay cả khi chưa đi đến final classification.

## LCSP Wizard UX Brief

### Product Role

Wizard của LCSP là **Manager-facing guided intake** để thu thập business/legal truth về hệ thống AI theo ngôn ngữ nghiệp vụ, tạo `WizardProfile` versioned, và đưa assessment vào trạng thái readiness phù hợp.

Wizard **không phải**:
- legal chatbot
- certification form
- final risk classifier
- technical evidence uploader

### UX Goals

- Manager tự hoàn tất được mà không cần hiểu codebase.
- Câu hỏi đủ sâu để phục vụ downstream reconciliation/legal matching.
- Câu chữ không dùng jargon kỹ thuật khi không cần.
- Output sau submit chỉ là readiness/preliminary guidance.
- Mọi blocked/missing state đều có next action rõ ràng.

### Target Structure

Wizard nên có 2 tầng:

1. **Pre-screen / Scoping**
   - Mục tiêu: phát hiện nhanh prohibited/high-risk/transparency-relevant patterns và profile dữ liệu/quyết định.
   - Dạng UI: card stack hoặc step ngắn 5-8 câu.

2. **Business/Legal Structured Intake**
   - Mục tiêu: tạo `WizardProfile` có thể dùng downstream.
   - Dạng UI: sectioned stepper với autosave draft và explicit submit.

### Recommended Sections

1. **System Purpose and Context**
   - Hệ thống dùng để làm gì?
   - Quy trình nghiệp vụ nào bị ảnh hưởng?
   - Người dùng cuối là ai?

2. **Affected People and User Groups**
   - Nhóm người bị ảnh hưởng là ai?
   - Có nhóm dễ tổn thương hay quyền lợi nhạy cảm không?

3. **Data and Inputs**
   - Có dùng dữ liệu cá nhân không?
   - Có dùng dữ liệu nhạy cảm / special categories / biometric data không?
   - Nguồn dữ liệu đến từ đâu?

4. **Decision Role and Impact**
   - AI có hỗ trợ hay ảnh hưởng quyết định không?
   - Quyết định đó có ảnh hưởng đáng kể đến quyền/lợi ích của cá nhân không?

5. **Human Oversight**
   - Con người can thiệp ở đâu?
   - Có thể override / review / stop quyết định không?

6. **External AI / LLM Usage**
   - Có dùng model/provider bên ngoài không?
   - AI dùng cho generation, ranking, prediction, recommendation hay automation gì?

7. **Deployment and Operational Context**
   - Hệ thống đang thử nghiệm nội bộ hay dùng production?
   - Có dùng cho internal productivity hay cho end-user/customer-facing flow?

8. **High-Impact / Special Flags**
   - Có liên quan tuyển dụng, tín dụng, giáo dục, quyền tiếp cận dịch vụ, giám sát, biometric, law-enforcement-like processing, hay các vùng nhạy cảm khác không?

### Question Design Rules

- Mỗi câu hỏi critical phải có:
  - `question_id`
  - `wizard_profile_field`
  - `criticality`
  - `downstream_uses`
  - `readiness_impact`
  - `reconciliation_impact`
- Mỗi câu khó phải có:
  - `Vì sao LCSP hỏi câu này?`
  - ví dụ nghiệp vụ ngắn
  - option `Tôi chưa chắc`
- Không dùng trực tiếp các cụm như:
  - AST
  - API probing
  - CI pipeline
  - model call graph
  - dependency scan
  trừ khi nằm trong tooltip/help tách biệt.

### Interaction Rules

- Autosave draft theo section.
- Có progress indicator rõ.
- Submit chỉ bật khi đủ critical fields hoặc đã đánh dấu explicit unknown theo rule cho phép.
- Validation message phải là business language.
- Không dùng wording kiểu `high risk`, `non-compliant`, `illegal` ở Wizard-only stage.

### Output Rules

Sau submit, Wizard chỉ được tạo:
- `WizardProfile`
- readiness checklist
- missing information / missing evidence signals
- next steps để sang technical evidence

Wizard không được tạo:
- final risk level
- legal verdict
- final compliance status

### Scenarios To Design First

- Public chatbot / customer support assistant
- Internal HR screening / ranking / decision support
- Credit / eligibility / consequential business decision support

## Implementation Considerations and Team Recommendations

### Team Recommendation

- **Minh**: giữ owner cho product direction, Wizard truth model, và cross-epic sequencing.
- **Nhi**: owner trọn module Auth, bao gồm chuỗi Epic 1 và các seam auth/session/membership/RBAC liên quan.
- **Tú / Anh / Thụy**: nên tách vai trò quanh Epic 2 theo 3 lane:
  - Wizard UX + question architecture
  - Wizard/API contracts + persistence
  - research-to-mapping / traceability / readiness semantics

### Suggested Immediate Work Split

1. **Nhi**
   - đóng `1-1` review
   - lên plan cho `1-2`, `1-3`, `1-4`

2. **Một người lane UX**
   - chuyển brief này thành canonical Wizard UX spec

3. **Một người lane schema/contracts**
   - tạo `question-to-WizardProfile mapping table`

4. **Một người lane stories**
   - tinh chỉnh `2-1`, `2-2`, `2-3`, `2-4` theo brief mới

### Immediate Implementation Framework

- Trước khi dev Epic 2, cần có thêm 3 artifact:
  - Wizard UX spec canonical
  - mapping table câu hỏi -> `WizardProfile`
  - scenario set cho 3 use case đầu

## Research Methodology and Source Verification

### Primary Sources

- European Commission AI Act page
- EUR-Lex AI Act
- EUR-Lex GDPR
- European Parliament AI Act release
- CNIL PIA official page
- ICO Data Protection Audit Framework
- AI Act Service Desk

### Secondary Sources

- `Complying with the EU AI Act`
- `TAI Scan Tool`
- `Knowledge-Augmented Reasoning for EUAIA Compliance`
- `A Survey on Methods and Metrics for the Assessment of Explainability under the Proposed AI Act`
- `ALTAI` related academic analysis

### Research Quality Notes

- Legal/timeline claims: độ tin cậy cao
- UX pattern claims: độ tin cậy trung bình-cao
- Market-share / vendor dominance claims: độ tin cậy thấp hơn, nên không dùng làm căn cứ chính cho product direction

## Research Conclusion

### Summary of Key Findings

Benchmark châu Âu xác nhận rằng Wizard tốt cho LCSP phải:
- risk-based ở entry
- business-language ở intake
- readiness-only ở output
- source-grounded ở guidance
- versioned và traceable ở artifact layer

### Strategic Impact Assessment

Research này đủ cơ sở để nói rằng **Epic 2 chưa nên dev thẳng theo packet hiện tại** nếu chưa khóa lại Wizard UX canonical và mapping table. Đây là nút cổ chai đúng, nhưng cũng là cơ hội để sản phẩm khác biệt rõ ràng.

### Next Steps Recommendations

1. Tạo ngay Wizard UX spec canonical từ brief này.
2. Cập nhật story packets Epic 2 theo brief mới.
3. Chốt staffing/ownership cho Epic 2.
4. Chỉ sau đó mới mở `create-story` / `dev-story` cho `2-1` và `2-2`.

---

**Research Completion Date:** 2026-06-26
**Research Period:** Comprehensive analysis
**Source Verification:** All substantive claims grounded in cited official or primary/academic sources
**Confidence Level:** High for regulatory/pattern conclusions; medium for market-structure inferences
