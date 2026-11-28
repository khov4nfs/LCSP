# G-06: kiểm kê điểm gọi model cho Assessment

Ngày đối chiếu: 2026-11-28. Đây là kiểm kê **source đang checkout**, không phải bằng chứng 100% trên deployment. `MODEL_USAGE_DEBIT=OFF`; không suy diễn trạng thái GREEN từ các test fixture.

## Ranh giới đã xác minh trong source

| Đường thực thi | Bằng chứng source | Kết luận |
| --- | --- | --- |
| Assessment Root | `deepagents/assessment_root/boundary.py:174` gọi runner; `assessment_root/runner.py:404,543` tạo và gọi graph; `assessment_root/agent.py:305-308` đưa `MODEL_GOVERNANCE_MIDDLEWARE` vào Root và researcher. `assessment_root/execution_policy.py:96-105` không cho policy bỏ hoặc đảo thứ tự middleware. | **EXTRACTED**: Root mặc định được nối với admission middleware. `apps/api/test/billing-assessment-root-admission.e2e-spec.ts` kiểm chứng Root boundary/runner/graph với billing HTTP và PostgreSQL thật, nhưng thay claim/context và repository hydration bằng fixture. Chưa có bằng chứng Root run hoàn toàn thật. |
| Selected-rule preparation | `deepagents/rule_set_preparation/selected_rule.py:50,96-105` dùng model/graph có governance; `apps/api/test/billing-admission.e2e-spec.ts:1795` kiểm chứng boundary và billing HTTP trên test DB. | **EXTRACTED**, có E2E fixture cho nhánh này; không đại diện cho mọi model route khi deploy. |
| Full-source preparation và claim author | `deepagents/rule_set_preparation/runner.py:623`, `rule_set_preparation/agent.py:551,653-709`; `apps/api/test/billing-admission.e2e-spec.ts:1905` kiểm chứng boundary trên test DB. | **EXTRACTED**, có E2E fixture; cần kiểm tra bảng route thực tế. |
| Summarization, source reader, localization | `deepagents/middleware/model_governance.py:330-424,430-611,652-672` bọc model bằng graph governance; `deepagents/orchestration/localization.py:239-249,445-446,598-599,818-819,967-968` dùng runnable bọc này. | **EXTRACTED** về wiring; rehearsal offline kiểm tra thứ tự request → consume → provider, chưa chứng minh mọi nhánh trên deployment. |
| Retry, key rotation, provider/token fallback | `deepagents/middleware/model_governance.py:305-325` đặt `UsageMeteringMiddleware` trong cùng chuỗi với retry/fallback; `usage_metering.py:1766,1828` xin admission trước sync/async dispatch. | **EXTRACTED** về thứ tự middleware; số route fallback đang bật là vấn đề cấu hình deployment. |
| Jev decision gateway | `deepagents/decision/gateway.py:65-77` gọi `TypeSafeJevClient.invoke`; `decision/typesafe_client.py:67-121` retry và `httpx.post` trực tiếp. `decision/pr_review_triage.py:486` và `decision/shadow.py:124-130` là caller quan sát được cho PR triage. | **EXTRACTED**: đường Jev đi ngoài `UsageMeteringMiddleware`. **AMBIGUOUS**: deployment có bật provider này và có tính phí hay không. Source hiện tại không nối nó với Assessment Root; không tính nó là đường Assessment đã được bảo vệ. |

## Route được kiểm kê

`deepagents/config/model_routes.yaml:1-23` khai báo một route `anthropic-primary` (`claude-sonnet-4-6`) cho Root, researcher, preparation, response transform và claim author, không khai báo fallback. `deepagents/model_policy.py:234-260` nạp route theo file cấu hình; vì vậy file trong repo chỉ chứng minh mặc định checked-in. Cần xuất manifest route đang chạy và so với bảng này trước khi tuyên bố G-06 đạt 100%.

## Bằng chứng còn thiếu để đóng G-06

1. Một Assessment Root run đi qua `AssessmentRootBoundary.handle()` → claim/context thật → graph model call → admission/consume/settle HTTP thật → bản ghi PostgreSQL; fixture thay thế một mắt xích phải được ghi rõ.
2. Kiểm kê route, credential pool và fallback đang bật ở deployment, gồm Jev gateway nếu được bật.
3. Shadow telemetry trên cùng cửa sổ thời gian chứng minh mỗi physical provider attempt có đúng một admission/consume và kết cục settlement/reconciliation; test fixture không thay thế số liệu này.
4. Biên lai startup, rotation, loss recovery, terminal deletion cho worker capability envelope như `docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md:258` yêu cầu.

Không đổi trạng thái G-06 sang GREEN khi bốn mục trên chưa được kiểm chứng.
