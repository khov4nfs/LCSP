# T31 — chỉ mục bằng chứng và đối chiếu với develop, ngày 06/11/2026

## Trạng thái của bộ thay đổi

Bộ tích hợp này đối chiếu toàn bộ thay đổi cục bộ đã thu thập với `develop` tại `711ad063878c034db57662feb53852a69bddb14d`, trên nền nhánh PR tại `fbaf95713625165f5f91326d2a557bbcac4d711f`. Manifest ban đầu có 120 tệp; ảnh chụp làm việc hiện tại có thêm hai kiểm thử web, thành **122 tệp đầu vào**. Các tệp hỗ trợ, kiểm thử và chỉ mục mới được tạo trong lượt tích hợp nằm ngoài con số đầu vào đó.

Tất cả 122 đường dẫn đầu vào được liệt kê trong [bản kê máy đọc](t31-reconciliation-evidence-index-20261106.json). Bộ này giữ cả mã nguồn cần đối chiếu, tài liệu và lịch sử kiểm chứng; phạm vi không bị giới hạn vào danh sách 10 tệp của PR trước.

**Các báo cáo lịch sử không chứng nhận bản tích hợp hiện tại hoặc một lần chạy T31 mới.** Những chữ `PASS`, `COMPLETE`, `SUCCEEDED`, số lượng kiểm thử và kết luận pháp lý bên trong các tài liệu cũ chỉ mô tả hoặc khẳng định kết quả ở thời điểm được ghi. Các giới hạn về phạm vi nguồn, bằng chứng và đánh giá pháp lý được ghi rõ bên dưới. Lượt đối chiếu này không chạy mô hình trả phí, không tự trả lời HITL, không tăng ngân sách, không đặt lại sổ sử dụng và không kích hoạt candidate Rule Set.

## Cách đọc lịch sử được giữ lại

Các bằng chứng lịch sử nằm trong `reports/t31-history/`, giữ cấu trúc đường dẫn gốc bên dưới. Trường `publishedPath` trong bản kê ánh xạ từng đường dẫn đầu vào sang vị trí công bố. Đây là vị trí báo cáo lịch sử đã được quy ước sẵn trong repo; bộ kiểm tra thuật ngữ và các quy tắc phân loại không thay đổi.

Có **29 tệp bằng chứng lịch sử** trong đầu vào. **28 tệp được giữ nguyên từng byte**. Một báo cáo đã thay đúng hai lần xuất hiện của email tài khoản khách hàng bằng `[REDACTED_CUSTOMER_ACCOUNT]`; nội dung đánh giá còn lại được giữ nguyên. Bản kê máy đọc ghi SHA256 gốc, SHA256 được công bố và loại bằng chứng của từng tệp.

| Nhóm | Tệp | Cách sử dụng |
| --- | --- | --- |
| Báo cáo nghiệm thu ban đầu | `OLD_T31_ACCEPTANCE_REPORT.md`, `T31_E2E_ACCEPTANCE_REPORT.md`, `LCSP_POST_FIX_ACCEPTANCE_REPORT.md`, `T31_OLD_VS_CONTROLLED_V2_COMPARISON.md` | Lịch sử của các lần chạy/nhận định trước. Không dùng các tiêu đề PASS/COMPLETE làm kết quả mới. |
| Báo cáo và câu trả lời đã xuất | `T31_HITL_ANSWER_LEDGER.md`, `T31_CONTROLLED_V2_FINAL_REPORT.json` | Giữ dấu vết lời đáp, quyết định và nguồn đã được ghi. Rà soát nguồn ngày 04/11 phát hiện giới hạn của bằng chứng và phạm vi dự án; việc giữ tệp không xác nhận lại tính đúng đắn của kết luận. |
| Trích xuất HITL ngắn | `hitl_ledger_raw.json` | Chỉ chứa ba dòng đầu vào. Không chứng minh tổng số câu hỏi hoặc hoàn tất toàn bộ case. Trình tạo ledger mới suy ra số đếm từ chính dữ liệu, không ghi sẵn 49/49 hay trạng thái thành công. |
| Hợp đồng câu trả lời v2.0.1 | `T31_V2_0_1_CANONICAL_SUBMISSIONS.json`, `T31_V2_0_1_CANONICAL_VALIDATION.json`, `T31_V2_0_1_PREFLIGHT_CORRECTION_REPORT.md` | Bằng chứng kiểm tra hợp đồng ngoại tuyến tại thời điểm đó. Không phải các câu trả lời được tự động nạp cho Root hoặc cho case mới. |
| Rà soát pháp lý và candidate | `T31_LEGAL_RULESET_AUDIT.md`, các tệp `candidate-rule-set-v2-*`, `t31-legal-source-review-2026-11-04.md` và receipt đi kèm | Tiếp tục là `LEGAL_REVIEW_PENDING`. Bản tóm tắt sửa 17 mục và packet đầy đủ có vai trò khác nhau; không tệp nào trong bộ này là lệnh kích hoạt hay phê duyệt pháp lý độc lập. |
| Kiểm chứng kỹ thuật Phase 2, nâng cấp và các mốc ngày 04/11 | Các tài liệu `t31-phase2-*`, `t31-next-milestones-*` và các receipt JSON tương ứng | Bằng chứng kỹ thuật lịch sử trên dữ liệu đại diện, mô hình lập sẵn và mã nguồn được ghi trong receipt. Số migrations và số assertions cũ không phải số của develop hiện tại. |
| Preflight và các pilot ngày 04–06/11 | Các tài liệu `t31-live-preflight-*`, `t31-live-pilot-*`, `t31-google-pilot-*`, `t31-compact-context-*` và receipt JSON tương ứng | Giữ các lỗi/điểm dừng thực tế: Docker hoặc chuẩn bị nguồn, allowance nhà cung cấp, admission và giới hạn input. Những receipt này ghi `semanticAcceptance: NOT_EVALUATED`; không được diễn giải thành nghiệm thu 243 rule. |

[Hướng dẫn xuất Assessment Session JSON](../../docs/implementation/assessment-session-json-export.md) là tài liệu tính năng hiện tại, được cập nhật cùng API/CLI xuất dữ liệu. Tài liệu đó không thuộc 29 tệp lịch sử bất biến.

## Các thay đổi tương thích cần thiết cho pilot

Mã bootstrap cũ giả định thiết lập repository đồng nghĩa với thực thi toàn bộ Rule Set. Với customer-selected audit hiện tại, ý định đó phải được tạo rõ ràng. Bootstrap V2 đọc hết catalog theo trang, kiểm tra đủ 243 định danh và phiên bản, snapshot/commit/digest, revision 0 và trạng thái chưa chọn; sau đó gửi `FULL_RULE_SET` qua API chủ sở hữu. Manifest riêng tư gắn request bất biến, băm membership và đúng command outbox do API tạo.

Lệnh pilot đã chuyển sang vòng đời native thực tế:

1. Yêu cầu host Linux có danh tính và các phép đo cgroup/Docker thật, endpoint loopback riêng, chế độ production và một worker.
2. Để `LocalAgentRuntime` đăng ký incarnation, quan sát capacity, giữ slot, ghi trạng thái và thực thi command.
3. Gắn policy chỉ trong tiến trình tin cậy; dữ liệu HTTP không chọn được policy. Boundary kiểm tra chính xác assessment, audit, command key, native run, incarnation và `PhysicalRunScope`.
4. Kiểm tra lại source pins, checkpoint thread của audit, membership đầy đủ và case chưa có fact/evidence/decision ngay trong Root đã được admit.
5. Giữ toàn bộ middleware production, phép đo input, sổ admission và các trần đã khóa. Cancellation dùng scope native hiện có; kết quả terminal đợi physical drain. Xác nhận giải phóng slot chỉ được ghi khi nhận receipt thành công từ API, tách biệt với việc bỏ theo dõi cục bộ.

Các trần giữ nguyên: tối đa 8 physical attempts, 120.000 input units tổng, 16.384 output tokens tổng, 90.000 input units mỗi attempt, 4.096 output tokens mỗi attempt, 180 giây model work, 600 giây chuẩn bị và 45 giây timeout đọc nhà cung cấp. Không suy ra một mức chi phí tiền tệ từ các trần kỹ thuật này.

Mặc định lệnh chỉ tạo preflight không gọi nhà cung cấp. Preflight không được tự gọi là đã có native admission. Dispatch còn cần phép đo capacity thật và reservation nguyên tử; máy macOS không được biến thành một host Linux có telemetry giả. Manifest V1, ledger cũ hoặc marker `native-dispatch.json`/`execution.json` đã tồn tại không được dùng để đặt lại hay tự tiếp tục một pilot.

## Profile công cụ hiện tại và số đo lịch sử

Root hiện đăng ký **20 công cụ nghiệp vụ** trong `ROOT_TOOL_NAMES`. Khi ghép với các công cụ native, graph và learning, request gửi tới model có **33 công cụ**. Kiểm thử [composition native đầy đủ](../../deepagents/tests/test_assessment_context_paging.py), hàm `test_native_root_keeps_registered_todos_grep_and_full_catalog_with_compact_model_descriptions`, kiểm tra trên graph thật và model lập sẵn: đủ 33 tên đúng thứ tự, cùng schema, callable và `return_direct`; bản rút gọn chỉ thay mô tả đã được rà soát. Hai công cụ bổ sung so với profile 31 công cụ là `wait_for_human_requests` và `report_existing_human_fact_unresolvable`.

Các số đo 31 công cụ trong receipt live pilot ngày 05/11 và Google pilot ngày 06/11 đã được thay thế về mặt cấu hình bởi profile 33 công cụ hiện tại. Chúng không đo kích thước request hiện tại và không chứng minh đủ ngân sách hoặc sẵn sàng gọi model. Receipt compact-context cũ có số đo 33 công cụ cũng chỉ gắn với mã nguồn, dữ liệu và lần đo đã ghi trong receipt đó. Cần đo request thực tế qua middleware hiện tại và được native admission chấp nhận trước bất kỳ lần chạy mới nào; không chuyển nhãn `READY`, `PASS` hoặc mức input cũ thành chứng nhận của lượt tích hợp này.

## Các công cụ vận hành và môi trường

| Công cụ | Hành vi hiện tại |
| --- | --- |
| `deepagents/scripts/run_resume_turn.py` | Bắt buộc chỉ rõ API, assessment và audit. Mặc định chỉ đọc; submit cần SHA256 của ý định đã xem và idempotency UUID riêng. Gửi route retry chủ sở hữu để workflow native hiện có xử lý, không gọi Root trực tiếp. |
| `scripts/resolve-last-hitl-playwright.mjs` | Bắt buộc chỉ rõ CDP, trang và request. Mặc định chỉ đọc fingerprint câu hỏi. Submit cần tệp trả lời riêng tư với đúng assessment/request/question hash; không còn ID hay câu trả lời kịch bản ghi sẵn. |
| `scripts/generate-ledger.py` | Bắt buộc chỉ rõ input/output; output tạo mới, không ghi đè. Hiển thị toàn bộ nội dung được cung cấp và số đếm thực tế, giữ rõ giới hạn của trích xuất. |
| Hai bản vá Node TOS và launcher | Chỉ hoạt động trên Darwin khi đặt chính xác `LCSP_NODE_DARWIN_TOS_COMPAT=1`; marker chung tránh bọc nhiều lần. Các nền tảng khác và lỗi khác giữ nguyên hành vi. |
| Prisma và migrations | Giữ cấu hình UTC theo connection, không bỏ startup options khác. Đường triển khai production vẫn dùng tài khoản migration riêng với tài khoản runtime có quyền hạn thấp hơn. |

Bộ kiểm tra kiến trúc chỉ cho phép đúng ba tệp trong `deepagents/scripts`: `run_resume_turn.py`, `run_t31_scoped_pilot.py` và `t31_native_runtime.py`; vẫn kiểm tra không có import/call trực tiếp `run_assessment_root` trong các công cụ đó. Các allowlist của công cụ và native boundary hiện hữu tiếp tục được giữ.

## Bằng chứng kiểm tra của lượt đối chiếu này

| Phạm vi | Kết quả đã quan sát | Giới hạn |
| --- | --- | --- |
| Native policy, frozen budget, SDK transport mock, architecture và cấu hình cũ | 96 kiểm thử Python PASS | HTTP nhà cung cấp bị chặn hoặc thay bằng mock; không phải chạy mô hình thật. |
| Bootstrap full243 | 20 kiểm thử Node PASS | Kiểm tra paging, membership, pins, intent và drift bằng owner API fixture; không tạo case thật. |
| Ledger và retry operator cùng regression hiện có | 13 kiểm thử Python PASS | Dữ liệu cục bộ và HTTP mock, không submit retry thật. |
| Guard của công cụ trả lời qua browser | 13 kiểm thử Node PASS | Kiểm tra target và answer packet; không mở browser hoặc gửi câu trả lời. |
| Darwin TOS và launcher liên quan | 21 kiểm thử Node PASS | Giả lập platform/Socket để kiểm tra opt-in, idempotence và giữ nguyên lỗi. |
| Populated upgrade Phase 2 | 68 assertions PASS, 143 → 146 migrations | PostgreSQL sở hữu riêng; kiểm tra lịch sử, múi giờ, sai audit/checkpoint/dependency và UNKNOWN selected hợp lệ. Không phải dữ liệu production. |
| Admission capacity với UNKNOWN review và phục hồi lượt lỗi | 52 kiểm thử PostgreSQL PASS, 1 SKIP | Giữ exact review/audit/checkpoint, fairness và từ chối demand đã tiêu thụ. Ca RabbitMQ bị bỏ qua vì gate này không chạy broker. |
| HITL vertical hợp nhất | **PASS: 298 assertions, 8 kịch bản; gồm 49 kiểm tra source scope** | API đã build, PostgreSQL đã migrate, PostgresSaver và worker process thật; model lập sẵn, admission fixture tổng hợp. Không chứng nhận capacity hoặc semantic acceptance cho pilot trả phí. |

### Dấu vết gate cuối

Lượt HITL `r6` kết thúc thành công lúc **2026-11-06 13:40:23 UTC**, exit code 0. Tám kịch bản đều PASS: UNKNOWN có bằng chứng dẫn tới BLOCKED rồi hồi phục bằng câu trả lời đã biết; UNKNOWN không đủ bằng chứng tiếp tục chờ; một fact dùng chung cho hai rule; phục hồi sau crash trước finish ở cả WAIT và BLOCK; retry checkpoint sau lỗi có kiểm soát; UNKNOWN trong selected audit; và tính bất biến của source/search evidence. Con số 49 kiểm tra source scope nằm trong tổng 298 assertions.

| Bằng chứng | SHA256 của đúng phiên bản đã kiểm tra |
| --- | --- |
| [Script HITL vertical](../../tests/assessment-hitl-phase2-vertical.mjs) | `5bd17d05e571c03453d48e7b1304dbaa6b0f951185c8e5598ecab00bf8440a43` |
| [Fixture Python](../../deepagents/tests/vertical/hitl_phase2_root.py) | `5fb94a50609db1d35161021b17c1d2e561fbec21c3df9002062c88b0fa3fd670` |
| `phase2-vertical-r6.log` | `ece90bcf3b5e538a832a3bbe3801b24cee8ded00696721929b7d4cada51f2f15` |
| `phase2-vertical-r6.json` | `f14bbe038de92904b10705843b89fa28d3547723258b253679f835da5f8cbaf7` |
| `api-capacity-failed-review-integration.log` | `a95692e77ac394e3fb95eebb077d66a6ee51ca3c14967f4cc7c42b005364af53` |

Các log và receipt cục bộ ở `.cache/t31/reconcile-all-20261106/`; các hash trên ràng buộc kết quả vào đúng đầu vào và bằng chứng đã quan sát. Chúng không thay thế CI của commit được công bố.

Ca `GRACEFUL_FAILED_REVIEW_CHECKPOINT_RETRY` kiểm tra **phục hồi qua transport trong fixture không gọi nhà cung cấp**. Với trạng thái legacy `FAILED` + `WAITING_FOR_HUMAN`, các route owner/UI hiện có chưa cung cấp thao tác retry này. Fixture phải chứng minh demand đã tiêu thụ bị từ chối, sau đó tạo một command tổng hợp mới theo mẫu transport của fixture và đi qua reserve/claim thông thường. Nó không mở lại demand cũ, sửa trạng thái case, checkpoint hoặc câu trả lời. Kết quả kỹ thuật của ca này không chứng nhận một luồng retry dành cho người dùng đã tồn tại.

### Kiểm tra sau khi đẩy bản tích hợp

CI của commit đầu tiên đã chạy thành công 23 bài Chromium, gồm tải attachment một lần với cookie phiên, đúng bytes, dọn anchor tạm và không có lỗi trang/console. [Log job trình duyệt](https://github.com/khov4nfs/LCSP/actions/runs/42227960449/job/127926266301) gắn với commit được ghi trong bản kê.

Các lỗi CI đã được sửa và kiểm chứng lại: 91 test API PASS; typecheck, build và ESLint toàn bộ 840 tệp API PASS, không lỗi/cảnh báo; 88 test scoped/native pilot PASS, cùng sáu ca digest cũ chạy được khi checkout không có API build. Production vẫn từ chối thiếu artifact build; các test digest dùng cây fixture riêng và có hai ca từ chối build root thiếu.

Báo cáo lịch sử được đặt đúng vùng báo cáo đã có của repository. Bộ kiểm tra thuật ngữ không đổi: 3.075 tệp được quét, không có lỗi thuật ngữ hiện hành; canary thuật ngữ cũ vẫn bị từ chối. Các byte lịch sử và ngoại lệ lược bỏ email đã ghi ở trên vẫn giữ nguyên.

Các tệp log chi tiết được giữ trong vùng kiểm chứng cục bộ; bản kê máy đọc ghi loại kiểm tra và phạm vi. CI và receipt tích hợp cuối của nhánh là nguồn trạng thái cho toàn bộ thay đổi, bao gồm các phần API/Web/source do các nhóm tương ứng kiểm tra.

## Rà soát nội dung trước khi công bố

Đã kiểm tra nội dung 50 tệp thuộc nhóm pilot, operator, hỗ trợ và lịch sử cho chuỗi khóa nhà cung cấp, JWT, private key, URL có credential, email, số điện thoại và các trường JSON có tên nhạy cảm. Không phát hiện credential/session thực trong nhóm này. Các URL có user/password tìm thấy là placeholder loopback cho fixture; các dãy giống số điện thoại đều nằm trong hash/UUID, không phải số liên hệ. Các object `authorization` trong hai receipt pilot là metadata phạm vi cho phép, không chứa token xác thực.

Một email tài khoản khách hàng cá nhân xuất hiện hai lần trong `T31_E2E_ACCEPTANCE_REPORT.md` đã được lược bỏ khỏi bản công bố. Bản gốc trong cây làm việc ban đầu được giữ nguyên; chỉ mục ghi rõ ngoại lệ này. Các định danh assessment, hash và bằng chứng lịch sử không liên quan đến email được giữ để đối chiếu. Việc rà soát này không biến các nhận định pháp lý cũ thành kết luận được phê duyệt.

Các file tạm do kiểm thử tạo được chuyển vào vùng cache bị Git bỏ qua. Không đưa cơ sở dữ liệu kiểm thử, socket, PID, private runtime manifest, credential hoặc ledger đang chạy vào bộ mã nguồn/bằng chứng công bố.
