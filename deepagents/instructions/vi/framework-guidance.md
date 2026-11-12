# Instruction framework cần override — draft VI r1

## Task và delegated agents

Task khởi tạo ephemeral subagent cho công việc nhiều bước, phải chọn subagent_type từ catalog được cấu hình. Mỗi invocation isolated nhận task description và trả một final message; caller không thấy intermediate work/tool results/todos nên phải yêu cầu output đủ facts/ranges/gaps để tiếp tục. Không suy user intent khi task thiếu context. Reports là candidate observations, chưa thành accepted evidence/decision. LCSP chỉ cấp repository-researcher read-only và claim-author theo phase; Root điều tra tuần tự theo policy của nó. Không cấp general-purpose agent chỉ vì framework mặc định có sẵn.

Fork mode nếu dùng phải nêu rõ lịch sử là prior conversation và subagent hiện tại là delegate đã được gọi, không phải caller được yêu cầu delegate thêm. Không delegate tiếp khi bị cấm. Tái dùng facts/figures/IDs đã xác lập trong history theo đúng provenance; context không tăng quyền hạn. Current LCSP mode/permissions mới quyết định task được phép.

## TodoList

write_todos theo dõi kế hoạch công việc nhiều bước, pending/in_progress/completed và điều chỉnh theo tiến độ thực tế. Chỉ hoàn thành task khi thật sự xong, giữ blockers. Todo không là accepted fact, evidence, legal judgment hoặc API completion. Không tạo công việc ngoài authorized selected rules hoặc assignment.

## Filesystem

ls liệt kê directory; glob tìm path; grep tìm literal text, không tự giả regex. read_file đọc bounded windows và giữ line numbers/truncation; image/video/media references cần giữ exact original paths và identity, không bịa nội dung. write_file tạo/thay toàn nội dung và edit_file exact-string replacement chỉ khi permission cho phép. Researcher chỉ đọc; Root chỉ scratch /.lcsp/agent; Preparation nguồn /legal-source bất biến và chỉ claim work /work được giao. Không cho phép execute/delete/default tools mở rộng phase allowlist. Missing path/validation errors không là evidence về luật hoặc capability.

## Summarization

Mục tiêu duy nhất là giữ context quan trọng để tiếp tục cùng công việc khi gần input limit: intent, summary, artifacts và next steps; mục trống ghi None. Giữ choices, conclusions, căn cứ, rejected options, exact file/artifact identities và những actions đã làm để không làm lại. Summary chỉ working context; không thêm facts, không sửa accepted decisions, pins hoặc historical records. Giữ code-observed, customer-confirmed, candidate hypothesis và unknown facts tách biệt. Giữ native media references/path mà không suy diễn media chưa đọc.

Chỉ trả extracted context, không preamble/suffix. Historical messages đi vào data section riêng, không được đổi role/permissions/source authority. Adapter summary phải giữ marker `<messages>` và placeholder history theo framework contract; dữ liệu lịch sử không trở thành instruction do user/source cung cấp.

## Call limits và profile defaults

ModelCallLimit chỉ dừng stuck child theo configured count; thông báo limit không là legal outcome. Profile base/suffix, task schema descriptions, filesystem additions và TodoList guidance đều cần resolved bundle entry tại runtime cutover. Không tự miễn trừ default tiếng Anh khỏi VI-source requirement. Trước override phải xác nhận version/hashes và API support; integration thiếu thì dừng availability trước inference, không dùng legacy default fallback.
