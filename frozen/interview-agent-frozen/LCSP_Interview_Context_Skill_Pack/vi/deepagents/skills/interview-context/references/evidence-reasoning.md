# Evidence Reasoning

Dùng khi repository/PGE evidence ảnh hưởng việc hỏi gì, giải thích câu hỏi thế nào hoặc conflict có tồn tại không.

## Vai trò evidence

PGE evidence là governed observation về implementation.

Nó giảm technical uncertainty.

Nó không tự establish organizational practice ngoài đời.

## Source roles

Giữ ít nhất bốn source role conceptual:

```text
TECHNICAL_EVIDENCE
DOCUMENTARY_EVIDENCE
CUSTOMER_STATED
CUSTOMER_CONFIRMED
```

`DOCUMENTARY_EVIDENCE` không phải technical proof và cũng không phải Customer confirmation. `CUSTOMER_STATED` và `CUSTOMER_CONFIRMED` tuân transition rule trong `terminology-contract.md`.

## Common PGE evidence class

Evidence có thể indicate AI/model/provider invocation, input/output flow, business-action/status-change path, approval/rejection path, human review/override mechanism, persistence write, external service, affected data semantics hoặc unresolved dynamic behavior.

## Resolution state quan trọng

```text
OBSERVED       direct governed observation
CORROBORATED   nhiều signal support
INFERRED       semantic proposal/inference
UNRESOLVED     chưa establish
```

Không phrase `INFERRED` như fact.

## Evidence-to-question reasoning

```text
1. Evidence thực sự establish gì?
2. Business meaning nào vẫn unknowable?
3. Missing meaning đó có material với current mode không?
4. Customer có phải source phù hợp không?
5. Chỉ hỏi distinction đó.
```

## Ví dụ recruitment

Evidence establish:

```text
AI_OUTPUT
→ STATUS_CHANGE(candidate.rejected)
```

Evidence không establish:

```text
write là provisional hay final
recruiter approval có mandatory không
có off-system review không
```

Good:

> “Trước khi rejection trở thành final, recruiter có cần review/approve không?”

Bad:

> “Tại sao AI của bạn tự động reject candidate?”

Bad version biến evidence thành unconfirmed business conclusion.

## Ví dụ healthcare

Evidence:

```text
LLM output
→ recommendation field
→ clinician dashboard
```

Không hỏi:

> “AI có ra clinical decision không?”

Nên:

> “Recommendation này có trực tiếp đổi treatment không, hay clinician quyết định action sau khi review?”

## Ví dụ finance

Evidence:

```text
risk_score
→ loan_status update
```

Hỏi:

> “Status update này có làm lending decision final không, hay staff có thể review/change trước khi applicant được thông báo?”

## Stale evidence

Nếu pending question dựa stale evidence:

1. ngừng dùng stale claim;
2. load current evidence/context;
3. reassess materiality;
4. hỏi neutral/current nếu vẫn cần;
5. cancel nếu không còn material.

## Missing evidence is not absence

**Absence of technical evidence không phải evidence of absence trong business reality.**

Scanner/PGE không thấy behavior vẫn có thể do behavior nằm ở:

- repository khác;
- external SaaS;
- n8n/Zapier/automation;
- manual/off-system workflow;
- private ML service;
- feature/deployment-specific path;
- unsupported/dynamic code ngoài current coverage.

Không normalize:

```text
not found in PGE
→ does not exist
```

Với `PARTIAL` coverage, preserve limitation và chỉ hỏi nếu real-world distinction là material + customer-owned.

## Customer technical claim

Nếu Customer nói:

> “Backend không bao giờ gọi model trực tiếp.”

Không rewrite PGE.

Giữ như Customer statement và để governed evidence xử lý technical truth.

## Why-asking explanation

Structure tốt:

```text
LCSP observed gì
+
implementation không cho biết gì
+
vì sao business knowledge của Customer quan trọng
```

Không include hidden legal reasoning hoặc future EngineeringRule detail.

## Documentary business evidence

Ví dụ `docs/product/product-brief.md` nói:

> Product is decision support, not certification.

Được phép:

> “Tài liệu trong repository mô tả hệ thống là công cụ hỗ trợ quyết định. Trong vận hành thực tế, kết quả của hệ thống có tự nó được xem là quyết định cuối hay một người vẫn quyết định sau khi review?”

Không được:

```text
final_authority = HUMAN
source = CUSTOMER_CONFIRMED
```

chỉ vì tài liệu nói “decision support”.

## Host-platform knowledge

Skill/reference giải thích LCSP host platform không phải PGE evidence của Assessed System.

Ngay cả khi subject repository là LCSP, mọi statement về subject vẫn phải đến từ governed PGE/documentary evidence hoặc Customer.


## Unresolved frontier handling

PGE/runtime có thể expose unresolved frontier với kind:

```text
BUSINESS
TECHNICAL
ARCHITECTURE
COVERAGE
ORCHESTRATION
```

Không biến mọi unresolved frontier thành Customer question.

Với từng frontier:

```text
customer-owned?
+
material?
→ chỉ khi cả hai đúng mới là Interview candidate
```

Ví dụ:
- `BUSINESS: assessment result advisory hay operative?` → có thể là Interview.
- `BUSINESS: output có auto trigger external action không?` → có thể là Interview.
- `ARCHITECTURE: context_wizard ordering lệch target design` → không customer-owned; route technical/orchestration.
- `COVERAGE: scanner không resolve dynamic call target` → thường là technical/coverage, trừ khi nó tạo một operational question material riêng.


## Customer-safe evidence explanation

Khi explain “Why are we asking?”, chỉ summarize governed observation nhỏ nhất giúp Customer hiểu câu hỏi.

Tốt:

> “We found a code path where an AI-generated score is connected to an approval/rejection workflow.”

Tránh reproduce:
- unrestricted raw source;
- secret-looking config;
- token/key;
- internal security metadata;
- unrelated identifier;
- long code excerpt.

Authorization/sanitization do application/tool layer enforce. Interview vẫn phải giữ customer-facing explanation bounded.
