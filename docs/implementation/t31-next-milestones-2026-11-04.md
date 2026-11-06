# T31 — Kết quả các mốc tiếp theo và giải thích file thay đổi

Ngày: **04/11/2026**  
Repository: LCSP · nhánh `develop` · HEAD `aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b`.

## Kết quả chính

Đã hoàn tất kiểm chứng nâng cấp dữ liệu đại diện, sửa lỗi lease lệch múi giờ, bổ sung phạm vi source bất biến cho snapshot và kiểm tra xuyên suốt API/runtime/checkpoint. Đã tạo candidate pháp lý đầy đủ để rà soát và bộ chuẩn bị pilot sử dụng baseline đang được duyệt.

Kết quả kỹ thuật: **209 kiểm thử API; 218 kiểm thử Python về runtime/source; 23 kiểm thử bộ giới hạn pilot; 8 kịch bản E2E với 255 assertions; nâng cấp 138 → 141 migrations với 59 assertions**, đều PASS trong phạm vi nêu dưới đây. Đây là kiểm chứng cục bộ, chưa phải chứng nhận kết quả đánh giá pháp lý hay triển khai production.

## 1. Vì sao Git hiển thị thêm nhiều file?

Danh sách Git là tổng các thay đổi chưa commit, bao gồm công việc đã có trước khi mốc này bắt đầu.

- Manifest bàn giao Phase 2 trước đó ghi **24 file mã nguồn/kiểm thử: 16 file đã được Git theo dõi và 8 file mới**, cùng 3 tài liệu/receipt. Khi bắt đầu mốc hiện tại, SHA-256 của cả 24 file vẫn khớp bàn giao.
- Các mốc hiện tại có thêm thay đổi có chủ đích cho lỗi múi giờ, phạm vi source, bài kiểm thử và bộ chạy pilot. Một phần sửa tiếp file đã xuất hiện trong manifest cũ; không cộng số lượng hai lượt một cách trực tiếp.
- Có 16 thư mục fixture do các lần kiểm thử cũ tạo ngoài vị trí cache: 152 file thường và 121 liên kết tượng trưng. Đã chuyển nguyên trạng vào cache bị Git bỏ qua, có manifest SHA-256; thao tác đảo ngược được và không xóa source.
- Những thay đổi đã có trước trong session export, frontend, báo cáo lịch sử và các công việc khác không được nhận là thay đổi của mốc này.

Danh sách file cùng hash trong receipt đi kèm là phạm vi bàn giao chính xác. Không dùng toàn bộ `git diff` của workspace đang có nhiều công việc dở dang để suy ra phạm vi riêng của lượt này.

## 2. Lỗi lease theo múi giờ và nâng cấp dữ liệu

**Root cause:** adapter PostgreSQL của Prisma truyền/đọc Date theo dạng không giữ đúng offset trong trường hợp được kiểm chứng. Khi session PostgreSQL dùng Asia/Ho_Chi_Minh, thời điểm lease lưu trong SQL lệch sớm **25.200.000 ms (7 giờ)** dù đọc ngược qua ORM có thể trông đúng. Kiểm thử RED đã chứng minh SQL coi một lease tương lai là hết hạn.

**Fix:** `PrismaService` buộc timezone UTC trên từng connection của ứng dụng, giữ ưu tiên và các option khác của connection URL. Không sửa lịch sử timestamp và không nới điều kiện kiểm tra lease.

Fixture populated upgrade dựng schema của **138 migrations**, tạo 8 request đại diện với pin, fact, lịch sử, runtime và coverage, rồi áp dụng đủ **141 migrations**. Kết quả:

- **59 assertions PASS**; giữ nguyên dữ liệu đại diện và backfill đúng 8 dependency rows.
- Session thực tế UTC trên server mặc định Asia/Ho_Chi_Minh.
- Ba trường hợp UTC, Asia/Ho_Chi_Minh và xung đột URL/PGOPTIONS đều có drift tương lai/hết hạn **0 ms**; giữ đúng statement timeout theo ưu tiên cấu hình.
- Migration mới thêm cột scope nullable; các snapshot lịch sử giữ scope null. Trigger ngăn đổi scope sau khi snapshot đã tồn tại.

Database kiểm chứng được tạo riêng ở loopback, không phải database ứng dụng đang dùng hoặc staging. Receipt nâng cấp 138 → 140 được tạo trước đó vẫn được giữ như lịch sử; receipt tổng hợp mới ghi rõ lần cuối là **138 → 141**.

## 3. Phạm vi source đúng của T31

| Pin | Giá trị |
|---|---|
| Repository | `tkhudson/AI-Powered-Customer-Support-Chatbot` |
| Commit | `65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b` |
| Subtree được phê duyệt | `tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot` |
| Assessment lịch sử | `5ec45c57-3625-4368-bedc-22824a396e5e` |
| Baseline Rule Set | `97004ff3-9240-4e37-8a94-9ade8832c00a` |

**Root cause:** commit được pin đúng nhưng chứa nhiều dự án. Snapshot cũ không ghi giới hạn subdirectory nên lượt đánh giá đã nhận **3 USE_CASE facts từ TheConstruct, ScriptToImages và Dig4Dinos**. Các file đó nằm trong cùng repository/commit, nhưng ngoài subtree chatbot đã được phê duyệt.

**Fix:** đưa `sourcePathPrefix` vào snapshot và giữ bất biến từ persistence tới API/runtime.

- Pin snapshot kiểm tra literal path trước khi gọi provider/lưu. Không tự chuẩn hóa đường dẫn mơ hồ.
- API nhận SOURCE và SEARCH evidence kiểm tra mọi đường dẫn/phạm vi trước cả replay/idempotency và tạo evidence.
- Hydration chỉ đưa file trong subtree được chọn vào sandbox và graph; giữ đường dẫn tương đối theo repository.
- Runtime marker, source coverage và checkpoint phải cùng scope. Scope thiếu/sai bị từ chối khi chạy scoped; không quay về toàn repository.
- Completion gate kiểm tra pin và scope. Snapshot cũ scope null giữ tương thích toàn repository; không được gán lại scope sau đó.
- Case pilot phải mới, không kế thừa fact, decision hoặc request của assessment cũ.

**255 E2E assertions** gồm 206 kiểm tra HITL/recovery/shared-fact trước đó và **49 kiểm tra mới** về scope SOURCE/SEARCH, replay, traversal, sibling prefix, scope bất biến và constraint SQL. E2E sử dụng API, PostgreSQL và PostgresSaver thật, worker riêng; phần phản hồi model được lập trình sẵn để kiểm tra trạng thái một cách xác định.

Giới hạn kỹ thuật: hydration vẫn tải archive toàn repository rồi lọc trước khi đưa source cho agent. Đây không phải download subtree từ phía provider. Files quá lớn và symlink bị loại theo chính sách an toàn hiện có; runtime phải biểu thị hạn chế coverage. SQL đếm độ dài theo ký tự trong khi TypeScript/Python dùng UTF-16 units; với một số Unicode rất dài, SQL có thể nhận rồi API/runtime từ chối. Khác biệt này không mở rộng scope và không ảnh hưởng prefix ASCII của T31.

## 4. Candidate pháp lý và dữ liệu lịch sử

Đã đối chiếu nguồn chính thức, corpus đang lưu và toàn bộ 243 ánh xạ LegalRequirement → AssessmentRule. Candidate mới giữ **633 LegalRequirement / 243 AssessmentRule**, đổi ý nghĩa phạm vi của đúng **17 LegalRequirement**, bổ sung các claim giới hạn/ngữ cảnh và phát sinh lại closure/guidance tương ứng.

File delta cũ không phải full packet; áp 17 sửa đổi trực tiếp vào baseline đầy đủ còn tạo **84 lỗi integrity**. Candidate mới đầy đủ qua schema, integrity, claim-inventory và semantic-freeze diagnostics với **0 lỗi**.

Trạng thái vẫn **LEGAL_REVIEW_PENDING**. Gate thực tế trả `CLAIM_INVENTORY_REQUIRED`; dùng inventory lịch sử cho candidate mới trả `STALE_INVENTORY_BINDING`. Chưa kích hoạt candidate, chưa sửa quyết định cũ. Kiểm tra cơ học không thay thế rà soát pháp lý, đặc biệt với thời điểm áp dụng, vai trò, chức năng dịch vụ công và bằng chứng hoạt động ngoài repository.

Baseline lịch sử xác định được tại caseRevision 20 có **204 NOT_APPLICABLE, 15 COMPLIANT, 24 NON_COMPLIANT**. Đây là nhãn quyết định đã lưu. Con số 77 trong audit cũ chưa ràng buộc được với revision/pins cụ thể nên không dùng phép trừ 77 → 60/61 để tuyên bố tác động.

Chi tiết điều luật, 17 ánh xạ, rationale lỗi, bằng chứng lẫn dự án, toàn bộ hash và giới hạn rà soát nằm trong [báo cáo nguồn pháp lý](t31-legal-source-review-2026-11-04.md) và receipt pháp lý.

## 5. Bộ chạy pilot có kiểm soát

Bộ chuẩn bị tạo database API/checkpoint riêng, nhập đúng baseline và provenance đã được duyệt, rồi tạo customer/case/snapshot qua API thật. Candidate đang chờ rà soát không nằm trong seed. Export không có users, assessments, facts, decisions, evidence, credential hay outbox lịch sử.

Bộ chạy giữ production Root, Docker backend và toàn bộ middleware governance. Mỗi attempt phải có measurement và reservation bền vững, gắn với execution thực tế đã claim. Root, researcher, tóm tắt và fallback dùng chung ngân sách.

| Giới hạn | Ý nghĩa thực thi |
|---|---|
| 8 physical model attempts | Trần chung, gồm retry/fallback; SDK retry ẩn được vô hiệu hóa/kiểm chứng |
| 120.000 input units/tokens trong sổ ngân sách | Đo serialized messages/tools bằng UTF-8 bytes cộng framing trước dispatch; tách khỏi token provider báo |
| 90.000 input allowance mỗi attempt | Reservation bảo thủ; usage đầy đủ có thể giải phóng phần chưa dùng; outcome chưa rõ giữ reservation |
| 16.384 output tokens tổng | Bao gồm output đã quyết toán và reservation chưa biết kết quả |
| 4.096 output tokens mỗi attempt | Đặt bằng option native của adapter |
| 180 giây | Hạn admission/hủy phần model-work sau khi chuẩn bị source |
| 600 giây | Alarm riêng cho hydration/indexing/kiểm tra heartbeat và tạo budget |
| 45 giây | Transport/read inactivity timeout của provider |

Các giới hạn này **không phải dollar cap**. 180 giây không phải tổng thời gian process và không bảo đảm provider từ xa đã dừng HTTP. Khi hủy, graph không nhận thêm nội dung/tool results của request đã bị bỏ; request đồng bộ đang chạy có thể còn sống trong daemon thread. Exposure chưa rõ vẫn được giữ; usage đến muộn có thể được ghi lại. Không có hard drain deadline riêng.

23 kiểm thử offline xác minh ledger thật và SDK với MockTransport; chưa chứng minh vận hành thật với Docker/provider. Docker Desktop đã được mở bằng cách thông thường nhưng engine chưa sẵn sàng. Đáng chú ý, lệnh docker có thể trả exit code 0 cùng version JSON rỗng; preflight đã được sửa để kiểm tra Version sau parse và kết nối Unix socket, không chỉ dựa vào exit code.


## 6. Kết quả chuẩn bị pilot thực tế

| Thuộc tính | Kết quả |
|---|---|
| Trạng thái bootstrap | **PREPARED_NO_PROVIDER** |
| Assessment mới | `fd82c0bf-2652-4bd8-9d57-af204ef0d0c4` |
| Snapshot mới | `9f76dbbf-0274-4ea9-aa3d-14e665d87e80` |
| Scan job | `709e0545-f1bc-439b-81a4-c35c7cdc29f0` |
| Case revision | **0** |
| Facts / evidence / decisions | **0 / 0 / 0** |
| Coverage entries | **243**, chưa có quyết định đánh giá |
| Chuỗi API khách hàng | **9/9 thành công** |
| Đối chiếu baseline | **29/29 bảng khớp mọi trường**, stored integrity PASS |
| Preflight mặc định | **BLOCKED_DOCKER_UNAVAILABLE** |
| Số lần gọi mô hình thật | **0** |
| Runtime code digest được kiểm tra | `21e9d5e9bc5f2fb41f4a1d6d18841d30273951438c80900fcfaf617f3755a7fc` |

Các record inventory, frontier, source review và activation là bản sao của baseline đã được duyệt. Trigger vẫn bật. Khi nhập, frontier chỉ ở trạng thái chưa frozen bên trong transaction; frozen timestamp nguyên bản được phục hồi trước COMMIT và toàn bộ end state được so canonical với export. Không tạo approval mới.

Bootstrap dùng GitHub CLI 2.98.0 đã có sẵn và thư mục tạm riêng có quyền ghi. Phiên bản CLI hệ thống không đủ và thư mục tạm OS bị EPERM là các blocker đã được giải quyết trong bộ chuẩn bị. Có **5 lần chuẩn bị chưa hoàn tất** được giữ nguyên để kiểm tra, không reset/drop. Lần thứ sáu tạo case thành công nêu trên; các lần chưa hoàn tất không tạo assessment.

API thử nghiệm đã dừng và cổng **50871** đóng. PostgreSQL do lượt này sở hữu đã dừng và cổng **64303** đóng, được xác nhận bằng kết nối TCP bị từ chối. Các database và manifest riêng tư quyền 0600 còn nguyên để tiếp tục. Không có worker/model của bộ thử nghiệm tự chạy nền; broker và agent-server của bộ thử nghiệm trỏ vào các cổng loopback không hoạt động.

## 7. Mốc tiếp theo và điểm chặn

1. **Docker engine sẵn sàng:** cần Docker Desktop chạy được engine. Lần này đã thử khởi động thông thường, nhưng cả socket được chọn và socket mặc định đều chưa tồn tại; không chuyển sang backend ngoài sandbox để chạy thay.
2. **Chạy pilot thật trên case mới:** khởi động lại đúng cluster cô lập đã lưu, resume API trong thời gian hữu hạn, chạy preflight rồi dispatch với digest runtime đã được rà soát. Thu receipt usage/admission, source coverage và trạng thái chờ người dùng hoặc kết quả dừng. Giữ gold scenario/answer contract ngoài đầu vào của Root.
3. **Hoàn thành workflow candidate pháp lý:** rà soát các điều kiện, vai trò, ngoại lệ và thời điểm; bind claims vào preparation thật, hoàn tất source review và frozen inventory theo gate hiện có. Không dùng inventory cũ cho candidate mới.
4. **Đánh giá đủ 243 rule và đối chiếu:** chỉ thực hiện sau các gate phù hợp của runtime và ruleset. So quyết định theo cùng pin, case revision và evidence; không suy aggregate mới từ phép trừ trong audit cũ.

Lệnh tiếp tục và chi tiết tham số nằm trong [preflight handoff](t31-live-preflight-2026-11-04.md). Toàn bộ phần chuẩn bị có thể kiểm tra được đã được hoàn tất; blocker của việc gọi mô hình hiện tại là Docker, còn candidate pháp lý vẫn có gate riêng.

## 8. Bảng kiểm chứng

| Kiểm chứng | Kết quả | Giới hạn |
|---|---|---|
| API tests liên quan | **209/209**, 15 suites | Không phải toàn bộ test suite của monorepo |
| Python source/runtime | **218/218**, 4 suites | Offline production paths |
| Bộ giới hạn pilot | **23/23** | SDK MockTransport; 0 model calls thật |
| Bootstrap guard/null/byte/isolation | **11/11** | Kiểm tra helper cô lập |
| Populated upgrade | **59 assertions**, 138 → 141 migrations | Database cục bộ, dữ liệu đại diện |
| HITL + source scope E2E | **8 kịch bản, 255 assertions** | API/PostgresSaver thật, model lập trình sẵn |
| Baseline copy | **29/29 bảng**, mọi trường khớp | Baseline hiện có; candidate không nhập |
| Customer setup | **9/9 request thành công** | Case mới, revision 0 |
| Build API + contracts/i18n + Prisma | **PASS** | Build dùng trong E2E |
| API TypeScript / ESLint phạm vi sửa | **PASS** | Không tuyên bố đã lint toàn monorepo |
| Business documentation | **0 missing/invalid**, checker **5/5 PASS** | Gate của dự án |
| Live model pilot | **CHƯA CHẠY** | Docker chưa sẵn sàng |
| Phê duyệt candidate pháp lý | **CHƯA HOÀN TẤT** | Authority gate tiếp tục chặn |

Khi bổ sung E2E, một assertion tác giả test đã kỳ vọng HTTP 201 ở endpoint evidence vốn khai báo HTTP 200. Đã sửa expectation cho khớp controller; sau đó toàn bộ 255 assertions PASS. Không thay production handler hoặc nới điều kiện nghiệp vụ để làm assertion đó qua.

## 9. Danh sách file của mốc hiện tại

Có **39 file code/schema/migration/test/script** trong phạm vi triển khai và **8 file báo cáo/dữ liệu kiểm chứng**, tổng **47 file**. Trong 39 file triển khai, **8 file mới** và **31 file có sẵn được sửa**. Cộng 8 báo cáo/dữ liệu mới, mốc hiện tại có **16 file mới**.

Bảy file trong manifest Phase 2 cũ được sửa tiếp ở mốc này để mang scope mới; 17 file còn lại vẫn khớp SHA bàn giao cũ. Tổng 47 không phải toàn bộ dirty tree và không được cộng trực tiếp vào 24 của Phase 2 vì có phần giao nhau.

| Nhóm | Số file |
|---|---:|
| Mã nguồn / shared contract / Prisma schema | 23 |
| Migration source scope | 1 |
| Kiểm thử và fixture | 13 |
| Script chuẩn bị/chạy pilot | 2 |
| Báo cáo, candidate và receipt | 8 |

### Code, schema, migration và test

Cột “Mới” chỉ file được tạo trong mốc hiện tại; “Sửa” bao gồm cả file chưa commit đã tồn tại trước lượt này. SHA đầy đủ được lưu trong receipt tổng hợp.

| File | Loại thay đổi | Nhóm | SHA-256 rút gọn |
|---|---|---|---|
| `apps/api/prisma/migrations/20261104150000_repository_snapshot_source_scope/migration.sql` | Mới | Migration | `7c3aa3157510` |
| `apps/api/prisma/schema.prisma` | Sửa | Mã nguồn / contract / schema | `bb2ae1c66250` |
| `apps/api/src/infrastructure/prisma/prisma.service.ts` | Sửa | Mã nguồn / contract / schema | `26db8cbe7463` |
| `apps/api/src/modules/assessment/application/commands/accept-assessment-evidence/accept-assessment-evidence.handler.spec.ts` | Mới | Kiểm thử | `62a6db695d8a` |
| `apps/api/src/modules/assessment/application/commands/accept-assessment-evidence/accept-assessment-evidence.handler.ts` | Sửa | Mã nguồn / contract / schema | `37c91b57e5d5` |
| `apps/api/src/modules/assessment/application/queries/get-root-context/get-root-context.handler.spec.ts` | Sửa | Kiểm thử | `60cc72d412c2` |
| `apps/api/src/modules/assessment/application/queries/get-root-context/get-root-context.handler.ts` | Sửa | Mã nguồn / contract / schema | `5a560ee6495e` |
| `apps/api/src/modules/assessment/application/services/assessment-completion-gate.service.spec.ts` | Sửa | Kiểm thử | `433280294298` |
| `apps/api/src/modules/assessment/application/services/assessment-completion-gate.service.ts` | Sửa | Mã nguồn / contract / schema | `18c847d5ca2c` |
| `apps/api/src/modules/assessment/infrastructure/persistence/assessment-case-support.service.spec.ts` | Sửa | Kiểm thử | `2feed9137004` |
| `apps/api/src/modules/assessment/infrastructure/persistence/assessment-case-support.service.ts` | Sửa | Mã nguồn / contract / schema | `83606e3491d0` |
| `apps/api/src/modules/assessment/infrastructure/persistence/assessment-repository-setup.loader.spec.ts` | Mới | Kiểm thử | `50cf3a8406f3` |
| `apps/api/src/modules/assessment/infrastructure/persistence/assessment-repository-setup.loader.ts` | Sửa | Mã nguồn / contract / schema | `84dab212b240` |
| `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.cli.spec.ts` | Sửa | Kiểm thử | `15eadbde795b` |
| `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.command.ts` | Sửa | Mã nguồn / contract / schema | `314d6497e72d` |
| `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.ts` | Sửa | Mã nguồn / contract / schema | `d59823814f2b` |
| `apps/api/src/modules/github-integration/application/contracts/github-integration/pin-snapshot.contract.ts` | Sửa | Mã nguồn / contract / schema | `f50f5eed8ed4` |
| `apps/api/src/modules/github-integration/domain/entities/repository-snapshot.entity.ts` | Sửa | Mã nguồn / contract / schema | `146974e3d254` |
| `apps/api/src/modules/github-integration/infrastructure/persistence/prisma-repository-snapshot.repository.spec.ts` | Sửa | Kiểm thử | `c8ecc4b36675` |
| `apps/api/src/modules/github-integration/infrastructure/persistence/prisma-repository-snapshot.repository.ts` | Sửa | Mã nguồn / contract / schema | `00098b9caf0b` |
| `apps/api/src/modules/github-integration/presentation/http/dto/pin-snapshot.request.ts` | Sửa | Mã nguồn / contract / schema | `9558bbe04cdc` |
| `apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts` | Sửa | Mã nguồn / contract / schema | `35f466ef9f0c` |
| `deepagents/assessment_root/boundary.py` | Sửa | Mã nguồn / contract / schema | `8a8bceaa6fcf` |
| `deepagents/assessment_root/runner.py` | Sửa | Mã nguồn / contract / schema | `fa095e7fe42d` |
| `deepagents/assessment_root/tools.py` | Sửa | Mã nguồn / contract / schema | `bb178058f8ac` |
| `deepagents/scripts/run_t31_scoped_pilot.py` | Mới | Script pilot | `03ed08681a12` |
| `deepagents/tests/test_assessment_root_agent.py` | Sửa | Kiểm thử | `27298297f706` |
| `deepagents/tests/test_codebase_memory_index.py` | Sửa | Kiểm thử | `d6e7e199a35c` |
| `deepagents/tests/test_repository_hydration_coverage.py` | Sửa | Kiểm thử | `80ff946e210b` |
| `deepagents/tests/test_t31_scoped_pilot.py` | Mới | Kiểm thử | `ef787867ffad` |
| `deepagents/tools/common/capabilities/platform/repository_sandbox.py` | Sửa | Mã nguồn / contract / schema | `6fff3f6228df` |
| `operator/t31_scoped_pilot_bootstrap.mjs` | Mới | Script pilot | `91c405133837` |
| `packages/contracts/src/assessment-domain/constants.ts` | Sửa | Mã nguồn / contract / schema | `07aff9b8696d` |
| `packages/contracts/src/assessment-domain/schemas.ts` | Sửa | Mã nguồn / contract / schema | `9841e642b6d7` |
| `packages/contracts/src/github-integration/codes.ts` | Sửa | Mã nguồn / contract / schema | `41d876aaa2f0` |
| `packages/contracts/src/github-integration/index.ts` | Sửa | Mã nguồn / contract / schema | `160c448121a6` |
| `packages/contracts/src/github-integration/source-scope.ts` | Mới | Mã nguồn / contract / schema | `1613cf620abb` |
| `tests/assessment-hitl-phase2-upgrade.mjs` | Mới | Kiểm thử | `09c1be26f5ef` |
| `tests/assessment-hitl-phase2-vertical.mjs` | Sửa | Kiểm thử | `2bf2f9821d55` |

### Báo cáo và dữ liệu

| File | Mục đích |
|---|---|
| `docs/implementation/t31-next-milestones-2026-11-04.md` | Báo cáo tổng hợp hiện tại và giải thích phạm vi file |
| `docs/implementation-artifacts/lcsp-t31-next-milestones-verification-20261104.json` | Receipt cuối: 141 migrations, 255 E2E assertions, file hashes, bootstrap/preflight |
| `docs/implementation/t31-legal-source-review-2026-11-04.md` | Rà soát nguồn pháp lý, 17 scope changes và giới hạn kết luận |
| `docs/implementation-artifacts/lcsp-t31-legal-source-review-20261104.json` | 243 ánh xạ, 17 quyết định, source/provenance và diagnostics |
| `docs/implementation-artifacts/candidate-rule-set-v2-source-review-pending-20261104.packet.json` | Candidate đầy đủ 633/243 để workflow rà soát xử lý |
| `docs/implementation/t31-live-preflight-2026-11-04.md` | Scope runtime, bộ giới hạn và lệnh tiếp tục |
| `docs/implementation-artifacts/t31-live-preflight-20261104.json` | Receipt scope, 218+23 tests, bootstrap và Docker preflight |
| `docs/implementation-artifacts/lcsp-t31-populated-upgrade-20261104.json` | Giữ kết quả trung gian 138 → 140; không ghi đè bằng lần 141 |

Hai file dữ liệu pháp lý lớn có mục đích riêng: candidate đầy đủ khoảng **10,2 MB** và receipt chi tiết khoảng **2,6 MB**. Chúng giữ đủ quan hệ claim/source và evidence để kiểm tra; không phải log mô hình phát sinh không kiểm soát.

Fixtures, export baseline, database thử nghiệm và receipts chứa trạng thái vận hành nằm trong cache bị Git bỏ qua. Bộ bàn giao không chứa credentials, private runtime manifest hay database. Không commit, push hoặc triển khai production trong lượt này.
