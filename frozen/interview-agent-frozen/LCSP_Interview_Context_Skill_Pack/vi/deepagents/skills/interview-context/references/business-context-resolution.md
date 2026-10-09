# Business Context Resolution

Dùng reference này khi Interview được gọi ở mode `BUSINESS_CONTEXT_RESOLUTION`: một phân tích rule đã báo cáo nhu cầu `BUSINESS_CONTEXT_REQUIRED` mà chỉ Customer mới có thể làm rõ.

## Mental model

Một phân tích rule đã kiểm tra evidence trong repository và chạm đến một business fact không thể xác định đáng tin cậy từ technical evidence. Runtime đã lưu fact đó thành một need có giới hạn (`targetedNeed`).

Nhiệm vụ của bạn rất tập trung: làm rõ một điểm phân biệt thuộc quyền sở hữu của khách hàng với Customer, mỗi lượt một điểm phân biệt. Bạn không phân tích mã nguồn, không đọc mã nguồn repository, không suy luận hay lập kế hoạch lại cho EngineeringRule phía dưới, và không quyết định kết quả tuân thủ của rule.

Sau khi Customer trả lời, runtime sẽ validate các statement đã được xác nhận và đánh giá lại chính rule đó một cách tất định (deterministic) với context này. Bạn không bao giờ tự ý resume, restart hay route luồng xử lý.

## Expected model-visible handoff

```text
mode: BUSINESS_CONTEXT_RESOLUTION
targetedNeed:
  needId
  question        # customer-safe wording của điểm phân biệt cần làm rõ
  observation     # mô tả trung lập, có giới hạn về những gì evidence chưa thể khẳng định
  resolutionCriterionIds
originatingRuleAnalysisReference
currentConfirmedBusinessContext
relevantInterviewHistory
```

Không yêu cầu hoặc để lộ:

```text
EngineeringRule text, legal intent, IDs hoặc trích dẫn
legal applicability
compliance criteria
mã nguồn repository hoặc đường dẫn file
```

## Required runtime fields

Mode này yêu cầu model-visible `targetedNeed` (với `needId`, `question`, `observation`, `resolutionCriterionIds`) và `originatingRuleAnalysisReference`. Nếu thiếu bất kỳ trường nào, return `FAILED` với mã limitation tương ứng.

Opaque continuation/checkpoint thuộc quyền quản lý của Assessment Orchestration và không phải reasoning context của Interview.

## Dữ liệu trả về được sử dụng như thế nào

Statement đã xác nhận mà bạn giải quyết ở đây không chỉ nằm lại trong Interview. Runtime gắn nó với `needId` và các `resolutionCriterionIds` tương ứng, sau đó cùng một rule được đánh giá lại một cách tất định với customer context đó. Một statement mơ hồ hoặc chưa được giải quyết sẽ khiến criterion tiếp tục chưa được giải quyết.

Do đó khi bạn return `CONTEXT_RESOLVED`:

- Lưu một confirmed statement cho mỗi mục trong `resolutionCriterionIds`, mỗi statement có `resolvesCriterionId` là id chính xác đó, dưới dạng một fact cụ thể, có thể khớp tự động (chính xác và có thể tham chiếu, không bao giờ là nhắc lại câu hỏi).
- Không return `CONTEXT_RESOLVED` cho một fact chỉ đúng về mặt xu hướng nhưng chưa được xác nhận cụ thể; runtime không tự bù đắp độ chính xác còn thiếu và không chấp nhận statement ước chừng.

## Flow

```text
rule analysis báo cáo BUSINESS_CONTEXT_REQUIRED
        ↓
runtime lưu targetedNeed (needId)
        ↓
Interview Agent hỏi một điểm phân biệt thuộc thẩm quyền khách hàng
        ↓
Customer trả lời
        ↓
CONTEXT_RESOLVED (statements kèm resolvesCriterionId)
        ↓
runtime validate câu trả lời theo need
        ↓
đánh giá lại chính rule đó một cách tất định
```

## Scope test

Trước khi hỏi, kiểm tra:

> Câu hỏi này có trực tiếp giúp giải quyết `targetedNeed.question` không?

Nếu không, đừng hỏi trong mode này trừ khi câu trả lời của Customer tạo ra điểm làm rõ liên kết trực tiếp cần thiết để diễn giải target. Mỗi lượt chỉ hỏi một điểm phân biệt.

## Good example

Handoff:

```text
targetedNeed.question:
Xác định thao tác ghi candidate-status=REJECTED đã là quyết định từ chối cuối cùng
hay chỉ là trạng thái tạm thời chờ phê duyệt của recruiter.

targetedNeed.observation:
Điểm số AI có thể đi tới thao tác ghi trạng thái từ chối.
```

Good question:

> “Khi hệ thống ghi nhận trạng thái từ chối ứng viên, quyết định này đã có hiệu lực ngay hay cần recruiter phê duyệt trước?”

## Bad — rule leakage

Bad question:

> “Thao tác này có thỏa mãn tiêu chí ENG-HO-14 không?”

## Conflict in targeted mode

Nếu câu trả lời của Customer mâu thuẫn với evidence đã lưu cho need này:

- Diễn đạt lại sự khác biệt một cách trung lập;
- Hỏi rõ quy trình vận hành thực tế;
- Nếu vẫn mâu thuẫn hoặc không thể xác nhận: return `BLOCKED_OR_UNRESOLVED`, không return `CONTEXT_RESOLVED`.
