# T31 — Bổ sung rà soát nguồn pháp lý và candidate đầy đủ

Ngày rà soát: **04/11/2026**  
Trạng thái: **LEGAL_REVIEW_PENDING**  
Phạm vi: đối chiếu toàn bộ 243 ánh xạ; sửa dự thảo 17 phạm vi áp dụng; kiểm tra cơ học bằng validator thật. Đây là phân tích nguồn của trợ lý, chưa có phê duyệt pháp lý độc lập.

## 1. Kết quả cần dùng

Đã tạo một **candidate packet đầy đủ**, giữ 633 LegalRequirement và 243 AssessmentRule, sửa phạm vi của đúng 17 yêu cầu đã chọn. Packet mới vượt qua schema, integrity, claim-inventory và semantic-freeze diagnostics với **0 lỗi**. Các kiểm tra thực thi không bị sửa hoặc nới lỏng.

Đây là bản để rà soát. Candidate sử dụng namespace và fingerprint dự kiến riêng; chưa có preparation/frozen inventory được lưu trong hệ thống. Gate thật trả **CLAIM_INVENTORY_REQUIRED** khi chưa có inventory mới và **STALE_INVENTORY_BINDING** nếu thử dùng inventory lịch sử. Chưa kích hoạt ruleset, chưa sửa quyết định cũ và chưa thực hiện reassessment trong công việc này.

Ba sản phẩm mới:

- [Candidate đầy đủ — đang chờ rà soát](../implementation-artifacts/candidate-rule-set-v2-source-review-pending-20261104.packet.json).
- [Receipt máy đọc, toàn bộ 243 ánh xạ, 17 quyết định và kiểm chứng](../implementation-artifacts/lcsp-t31-legal-source-review-20261104.json).
- Bản bổ sung hiện tại.

SHA-256 của file candidate: **f1d7c2950c01eccd8c9923e8d8383e8db2bca5a2c6fffd028815c659c2e41906**.  
Canonical packet digest: **4741b42f1c2b7ac67fa01a9ca98fcef305304cece4aa5bf1e00311655aa5aa9f**.

## 2. Authority đã đối chiếu với persistence

| Thành phần | Giá trị |
|---|---|
| Assessment | 5ec45c57-3625-4368-bedc-22824a396e5e |
| Trạng thái / caseRevision | COMPLETE / 20 |
| Repository | tkhudson/AI-Powered-Customer-Support-Chatbot |
| Commit | 65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b |
| Repository snapshot | 820a87d2-89ba-4315-8139-4a89f178f5c8 |
| Connection | 8f0302e6-2412-41d9-9449-292cb304462b |
| RuleSet | 97004ff3-9240-4e37-8a94-9ade8832c00a |
| Legal source | ea43540c-513e-4b76-969a-8415f06696f2 |
| Materialization | f53e155df40b96aa35099ad7982fd8ce41cd900b0bffa82bb5aa8bb729ef8f6a |
| RuleSet digest | f06180635588eb5c026a3dc2e9d3c4da1c3c92853258bb8463f2b52c2478d1ce |

Truy vấn chỉ SELECT, trong transaction có transaction_read_only=on, có timeout và truyền UUID bằng tham số. Không ghi thông tin kết nối hoặc thông tin xác thực vào receipt.

Dữ liệu quan sát: 633 LegalRequirement; 243 AssessmentRule; 243 liên kết giữa hai loại ID; 2.915 chunks; 1.684 provenance rows; 8 tài liệu; 243 quyết định hiện tại. Kết quả của assessment được chốt ở revision 20 là **204 NOT_APPLICABLE, 15 COMPLIANT và 24 NON_COMPLIANT**. Đây là nhãn quyết định được lưu; không phải xác nhận rằng có 24 vi phạm pháp luật đã được chứng minh.

File lịch sử T31_CONTROLLED_V2_FINAL_REPORT.json ghi đúng assessment, revision và các pin trên. Toàn bộ **243 decisionId** trong file trùng persistence hiện tại; summary của file cũng ghi 204/15/24. Truy vấn theo cùng repository, cùng connection hoặc tên chứa T31 thấy một assessment trong database đang cấu hình. Điều này không chứng minh rằng những môi trường hoặc bản ghi lịch sử đã xóa chưa từng có kết quả khác.

Audit và candidate cũ nêu baseline 77 nhưng không gắn con số ấy với assessmentId, caseRevision hay decisionFingerprint. Vì vậy chưa có cơ sở dùng 77 để trừ ra 60 hoặc 61. Audit tự nêu 16 lỗi trong khi bảng gồm 17 mục; candidate ghi 17 corrections nhưng impact lại giảm 16. Các con số tác động cũ không được kế thừa.

## 3. Kết quả nguồn pháp lý và giới hạn

### 3.1. Nhận diện và hiệu lực

| Văn bản | Ban hành | Hiệu lực | Nguồn |
|---|---|---|---|
| 134/2025/QH15 | 2025-12-10 | 2026-03-01 | [Nguồn chính thức](https://vanban.chinhphu.vn/?classid=1&docid=216334&pageid=27160&typegr=) |
| 142/2026/NĐ-CP | 2026-04-30 | 2026-05-01 | [Nguồn chính thức](https://vanban.chinhphu.vn/?docid=218029&orggroupid=2&pageid=27160) |
| 05/2026/TT-BKHCN | 2026-03-10 | 2026-03-10 | [Nguồn chính thức](https://vanban.chinhphu.vn/?docid=217165&orggroupid=4&pageid=27160) |
| 91/2025/QH15 | 2025-06-26 | 2026-01-01 | [Nguồn chính thức](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=) |
| 116/2025/QH15 | 2025-12-10 | 2026-07-01 | [Nguồn chính thức](https://vanban.chinhphu.vn/?classid=1&docid=216499&pageid=27160&typegrou=) |
| 356/2025/NĐ-CP | 2025-12-31 | 2026-01-01 | [Nguồn chính thức](https://vanban.chinhphu.vn/?docid=216387&pageid=27160) |

Ba văn bản đầu được rà soát các điều trực tiếp liên quan đến 17 sửa đổi. Với Luật 91, Luật 116 và Nghị định 356, công việc này xác minh nhận diện/hiệu lực; chưa xác nhận từng kết luận vi phạm trong audit cũ. Tám blob trong database khớp hash nội bộ; điều này không có nghĩa hash DOCX được tải lên phải bằng hash PDF chính thức. Ý nghĩa của các điều được chọn được so riêng với nguồn công bố.

### 3.2. Hai quy tắc đánh dấu nội dung

[Luật 134, Điều 11(2)](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/12/134-luat-qh.pdf) và [Nghị định 142, Điều 17(1)](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/142-2026-ndcp.signed.pdf#page=1) đặt phạm vi đánh dấu kỹ thuật vào đầu ra âm thanh, hình ảnh và video. Điều 17(1) có ngoại lệ đầu ra văn bản, kèm bảo lưu trường hợp pháp luật có quy định khác.

Baseline đã ghi âm thanh/hình ảnh/video ngay trong operative action; quy tắc Nghị định đã có ngoại lệ văn bản. Vì vậy, chỉ thấy applicabilityMode=UNCONDITIONAL không đủ để nói baseline đã bắt đánh dấu mọi đầu ra, hoặc hai quyết định hiện tại là false positive. Sửa đổi mới làm phạm vi thành điều kiện rõ ràng, gắn claim/source/closure và phát sinh lại guidance tương ứng.

Vai trò nhà cung cấp vẫn cần xét đúng định nghĩa. Điều 17(5) có cơ chế đáp ứng nghĩa vụ của nhà cung cấp mã nguồn mở/miễn phí và trách nhiệm riêng khi bên triển khai đưa đầu ra ra công cộng; không gộp các vai trò. Các nghĩa vụ nhận biết đang tương tác với AI và công bố nội dung gây nhầm lẫn ở Điều 11(1)/(3) cần được xét riêng; ngoại lệ đánh dấu văn bản không tự loại trừ chúng.

### 3.3. Mười lăm quy tắc Circular 05

[Thông tư 05, Điều 1(2)–(3)](https://congbao.cdnchinhphu.vn/180507251028987904/2026/3/24/469079-1774341042_v1_1774343649_signed.pdf) quy định phạm vi theo vai trò và chức năng phục vụ quản lý nhà nước/cung cấp dịch vụ công, đồng thời khuyến khích áp dụng rộng hơn.

**Tư nhân không đồng nghĩa tự động ngoài phạm vi.** Cần xác minh chức năng sử dụng thực tế. Bản mới giữ Điều 1(2) thành phạm vi của từng nghĩa vụ; giữ Điều 1(3) làm context khuyến khích. Không biến encouragement thành một ngoại lệ chung rằng mọi doanh nghiệp tư nhân đều được miễn.

Root cause: hai khoản Điều 1 có sẵn trong nguồn pinned, nhưng sourceAccounting lịch sử cho rằng chúng không có semantic claim cần giữ. Vì không sinh scope/context claim nên 15 nghĩa vụ không nhận các giới hạn đó. Fix ở dữ liệu dự thảo: tạo modifier/context claim có exact source spans, nối vào operative claims, cập nhật claim bindings/source refs, rồi sinh lại tiêu chí, guidance và evidence requests.

### 3.4. Ngày bắt đầu triển khai vẫn chưa được giải quyết

[Luật 134, Điều 35](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/12/134-luat-qh.pdf) có chuyển tiếp cho hệ thống hoạt động trước 01/03/2026: thời gian 12 tháng theo nhánh chung và 18 tháng cho y tế, giáo dục, tài chính. Cần xác minh ngày triển khai và đúng nhánh, cùng các quy định chuyển tiếp liên quan, trước khi kết luận nghĩa vụ đã đến hạn. Việc văn bản đã có hiệu lực không tự chứng minh một hệ thống cụ thể đã quá hạn tuân thủ. Candidate này tập trung 17 scope corrections, chưa chứng nhận toàn bộ phân tích thời điểm của corpus.

## 4. Ánh xạ đủ 17 ID và ảnh hưởng quan sát được

Tất cả 17 ID trong candidate cũ là LegalRequirement ID có thật. Mỗi ID liên kết đúng một AssessmentRule. Các trường baseline applicabilityMode, applicabilityConditions và exceptions trùng dữ liệu được lưu ở cả 17 mục. Các tên khác nhau giữa hai cột là ánh xạ hai loại thực thể hợp lệ, không phải missing rules.

| LegalRequirement ID | AssessmentRule ID | Quyết định hiện tại |
|---|---|---|
| luat134-art11-cl2-machine-readable-marking | luat134-art11-cl2-machine-readable-marking-impl | NOT_APPLICABLE |
| art17-cl1-mark-ai-content | AR-art17-cl1-mark-ai-content | NOT_APPLICABLE |
| art3-cl1-pta-safety-by-design | art3-cl1-pta-risk-prevention | NON_COMPLIANT |
| art3-cl1-ptb-quality-assurance | art3-cl1-ptb-quality-assurance | NON_COMPLIANT |
| art3-cl1-ptc-human-oversight | art3-cl1-ptc-human-oversight | NON_COMPLIANT |
| art3-cl1-ptd-resilience | art3-cl1-ptd-resilience | NON_COMPLIANT |
| art3-cl1-pte-security | art3-cl1-pte-security | NON_COMPLIANT |
| art3-cl2-pta-human-rights | art3-cl2-pta-human-rights | NON_COMPLIANT |
| art3-cl2-ptb-fairness | art3-cl2-ptb-fairness | NON_COMPLIANT |
| art3-cl2-ptc-transparency | art3-cl2-ptc-transparency | COMPLIANT |
| art3-cl2-ptd-explainability | art3-cl2-ptd-explainability | NON_COMPLIANT |
| art3-cl3-pta-social-benefit | art3-cl3-pta-social-benefit | NON_COMPLIANT |
| art3-cl3-ptb-inclusive-design | art3-cl3-ptb-inclusive-design | NON_COMPLIANT |
| art3-cl3-ptc-sustainability | art3-cl3-ptc-sustainability | NON_COMPLIANT |
| art3-cl3-ptd-cultural-values | art3-cl3-ptd-cultural-values | NON_COMPLIANT |
| art3-cl3-ptd-prohibition-discriminatory-content | art3-cl3-ptd-discriminatory-content-prohibition | NON_COMPLIANT |
| art3-cl4-ptb-social-responsibility | art3-cl4-ptb-responsibility-allocation | NON_COMPLIANT |

Tập 17 gồm **14 NON_COMPLIANT, 1 COMPLIANT, 2 NOT_APPLICABLE**. Do đó chỉ có 14 nhãn NON_COMPLIANT hiện tại nằm trong tập sửa này để xem xét loại bỏ; còn một nhãn COMPLIANT cũng có thể đổi nếu phạm vi bị bác bỏ. Hai quy tắc đánh dấu đã là NOT_APPLICABLE. Chưa có phép trừ tự động, chưa có aggregate mới và chưa có số vi phạm được chứng nhận. Receipt chứa toàn bộ 243 ánh xạ để kiểm tra phạm vi, không chỉ 17 mục được chọn.

## 5. Lỗi quyết định và bằng chứng cần xử lý riêng

Các vấn đề dưới đây không được giải quyết chỉ bằng sửa applicabilityConditions.

**Lý do NOT_APPLICABLE của hai quy tắc đánh dấu sai phạm vi rủi ro.** Quyết định 560551e6-77b6-4e3c-bf6a-b6c07da86e09 và b2d3f3d0-30f0-4f27-bce6-a8ea66aa32ae lập luận nghĩa vụ chỉ dành cho nhà cung cấp AI rủi ro cao/trung bình rồi dùng fact e59dd72e-1606-46d0-8bea-8045de713a0a để bác bỏ. Hai điều nguồn nêu trên không đưa ra giới hạn rủi ro như vậy. Kết quả có thể phù hợp nếu đầu ra thuần văn bản được xác minh đúng, nhưng kết quả phù hợp không làm lý do sai thành hợp lệ.

**Quyết định minh bạch dẫn sai văn bản và ý nghĩa.** Quyết định ebcf6957-a85d-4ce6-937d-a519a7e064a5 gọi nguồn là Decree 142 art3-cl2ptc; parent pinned thực sự là Circular 05 Điều 3(2)(c). Lý do dựa vào kiến trúc công khai/open source thay vì chứng minh đủ các thông tin minh bạch của điều nguồn. Nó còn suy từ commercially deploys thành provider mà không phân tích đầy đủ vai trò.

**Phạm vi chức năng và việc thực hiện biện pháp tổ chức chưa được chứng minh.** Các quyết định Circular chủ yếu dùng fact thương mại d919bfda-4f9d-4a96-aeeb-2890464521fd, không chứng minh chức năng quản lý nhà nước/dịch vụ công. Việc không tìm thấy kế hoạch, đánh giá tác động hoặc quy trình trong repository không tự chứng minh tổ chức không thực hiện ở ngoài repository.

**Cấm nội dung và bắt buộc bộ lọc cần được phân biệt.** Quyết định f94ee5de-13e8-456b-bfce-5a3149c92070 đánh giá quy tắc cấm nội dung phân biệt đối xử. Không thấy bộ lọc không tự chứng minh đã tạo nội dung bị cấm. Cần đúng phạm vi và bằng chứng về mệnh đề pháp lý được đánh giá.

Receipt giữ nguyên 17 rationale, applicabilityBasis, criteria và references để người rà soát kiểm tra những kết luận này.

## 6. Bằng chứng lẫn dự án đã lưu

Repository được pin chứa nhiều dự án. Ba trong bốn USE_CASE facts có authority=EVIDENCE_CITED và state=ACCEPTED mô tả dự án ngoài subtree chatbot được phê duyệt: tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot. Đối chiếu cây Git xác nhận các đường dẫn dưới đây có trong cùng repository và commit được pin; lỗi là thiếu giới hạn subdirectory khi đánh giá ứng dụng chatbot, không phải sử dụng một repository hay commit khác:

| Fact ID | Evidence ID | Đường dẫn được lưu |
|---|---|---|
| 0696812f-836e-5c5b-ae51-9a9150ff3b2e | 1c63984b-558c-5dae-ae55-38a38c39899a | tkh/Astromo/TheConstruct/src/utils/aiService.js:139–235 |
| 0696812f-836e-5c5b-ae51-9a9150ff3b2e | a1edceef-0400-59e6-aeb0-6515a49bb4a9 | tkh/Astromo/TheConstruct/src/utils/aiService.js:48–74 |
| 17cd2b2f-bf3a-5687-8a40-b5f6d388b913 | b23d324a-7f1d-5e86-a7d9-476426d873aa | tkh/upworkProjects/ScriptToImages/generateimages.py:260–318 |
| db2551ae-3b0c-50cc-b965-b6475e9ce13c | 43c352e8-2143-5e4c-be6a-11ecdb6a7ccc | tkh/Game/Dig4Dinos/README.md:51–62 |

TheConstruct, ScriptToImages và Dig4Dinos nằm ngoài subtree ứng dụng chatbot và không được kế thừa vào case kiểm chứng mới có phạm vi tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot. Bản ghi cũ được giữ để audit. Receipt lưu statement, state, đường dẫn, phạm vi dòng và hash cụ thể; đây là bằng chứng contamination, không phải lý do âm thầm sửa lịch sử.

Hai evidence dùng trong các quyết định Circular là c1aa7e51-6a05-5afe-baf1-5f704cf3b0c3 (app.py, dòng 17–70) và 0c9f0d09-e65b-5a12-8cc3-01aba4e8c9c6 (README.md, dòng 1–29), dưới đường dẫn Git thực tế tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot. Cần dùng checkout đúng commit và giới hạn vào subtree này trước khi dùng trong lượt mới.

## 7. Kiểm chứng thực thi và candidate mới

| Kiểm tra đã chạy | Kết quả |
|---|---|
| Dựng lại baseline packet từ DB, so canonical digest | Trùng f0618063…; historical integrity=true |
| 2.915 chunk hashes / 1.684 provenance rows | Không có mismatch |
| 8 stored document blobs | Đúng SHA-256 và độ dài nội bộ |
| Baseline đầy đủ qua schema/current integrity validator | PASS; 0 lỗi |
| File candidate cũ trực tiếp qua packet schema | FAIL; 4 lỗi hình dạng — delta object, không phải full packet |
| Áp 17 delta cũ vào baseline đầy đủ, phát sinh lại guidance | Schema PASS; integrity FAIL 84 lỗi |
| Nhóm lỗi của naive patch | 50 CLAIM_REQUIREMENT_MISMATCH; 34 DOWNSTREAM_AUTHORITY_MISMATCH |
| Candidate mới đầy đủ qua packet schema | PASS |
| Candidate mới qua validateComplianceRuleSetPacket | 0 lỗi |
| Candidate mới qua validateClaimInventory | 0 lỗi |
| Candidate mới qua semanticFreezeFailures | 0 lỗi |
| Gate khi chưa có frozen inventory được lưu | CLAIM_INVENTORY_REQUIRED |
| Gate khi dùng inventory lịch sử cho candidate mới | STALE_INVENTORY_BINDING |

Các hàm chạy từ build JavaScript thật của dự án. Receipt ghi hash file source/build, invocation, failures và coverage. PASS cơ học xác nhận cấu trúc và quan hệ nguồn; không thay thế đánh giá pháp lý.

Candidate có 1.500 semantic claims và 835 quan hệ: 1.467 claims lịch sử được cấp ID dự kiến mới để không giả mạo authority của preparation cũ, 17 operative frames được sửa phạm vi, và 33 modifier/context claims có nguồn. Các modifier được ràng buộc cho từng nghĩa vụ; số claim không phải số điều luật hay số vi phạm.

Đã rà soát trực tiếp 18 source review units liên quan; 2.845 units còn lại kế thừa nội dung lịch sử và được nêu rõ nguồn gốc. Source spans, source refs, closure và derived evidence requests đã cập nhật. Đối chiếu meaning sau khi bỏ khác biệt identity xác nhận chỉ **17 LegalRequirement** thay đổi ý nghĩa. Không thêm/bớt AssessmentRule.

Fingerprint của review frontier lịch sử được tính lại và trùng giá trị lưu. Fingerprint mới chỉ mô tả đề xuất offline, không đại diện cho workflow hoàn thành hoặc phê duyệt pháp lý. File packet giữ schema nghiêm ngặt; trạng thái LEGAL_REVIEW_PENDING và hash ràng buộc nằm trong receipt và tên file.

## 8. Mốc tiếp theo có thể thực hiện

1. Rà soát độc lập các 17 thay đổi, các điều kiện/ngoại lệ/role và phạm vi thời điểm. Với phần corpus kế thừa, không dùng PASS cơ học để tuyên bố đã kiểm chứng pháp lý toàn bộ.
2. Tạo hoặc reopen preparation đúng workflow, gắn claims vào run/revision thật, hoàn thành source review và freeze inventory. Hai gate authority hiện đang chặn đúng.
3. Đối chiếu lại actor/provider/deployer, chức năng quản lý nhà nước/dịch vụ công, thời điểm triển khai, các modality và tài liệu thực hiện nghĩa vụ ngoài repository. Thiếu thông tin phải giữ unresolved theo hợp đồng, không đổi thiếu bằng chứng thành vi phạm.
4. Sau khi đủ các gate tương ứng, dùng case mới với checkout đúng repository/commit và giới hạn vào subtree chatbot đã phê duyệt. Không kế thừa ba facts lẫn dự án. Một kiểm tra nhỏ về scope đánh dấu có thể dùng hai rule nêu trên; phải chứng minh đầu ra từ source pin và không dựa vào loại trừ rủi ro cao/trung bình không có trong điều luật.
5. Chỉ báo cáo delta bằng các quyết định mới được đối chiếu với đúng pins và evidence. Không công bố các tổng 60/61 hoặc chứng nhận các lỗi còn lại dựa trên audit cũ.

## 9. Bảo toàn lịch sử

Ba file lịch sử được kiểm lại SHA-256 và không thay đổi:

| File | SHA-256 |
|---|---|
| T31_LEGAL_RULESET_AUDIT.md | b04d0a1d6b6dc6435cf185a92acdcb0ea59be5998b1f9083a4b97493b42ae251 |
| candidate-rule-set-v2-legal-review-pending.json | 7542f4fffb6229649d0e6ee9912ab88588c3425eb4b94deab08f2061e8ab3265 |
| T31_CONTROLLED_V2_FINAL_REPORT.json | ad71d25363028141634aa08f06149de54ff94589f3596c7d409b66b60f24627d |

Không thay đổi production code, generic runtime, database, active ruleset, facts hay quyết định lịch sử trong lượt rà soát này. Ba file mới là dữ liệu candidate và bằng chứng rà soát thuộc phạm vi công việc đã giao.
