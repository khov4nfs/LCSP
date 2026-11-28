# Kế hoạch khắc phục module `legal-source`

Trạng thái: **đang triển khai** (28/11/2026). Gói 1 và 2 đã hoàn thành phần sửa lỗi và kiểm chứng scoped; gói 3–6 chưa sửa production code. Phạm vi là các lỗi đã được tái hiện bằng RED test trong `apps/api/src/modules/legal-source/application/services`; giữ nguyên các thay đổi đang có ngoài module.

## Mục tiêu và ranh giới

- Xóa nguồn, kích hoạt phiên bản và bắt đầu ingest phải dùng trạng thái mới nhất dưới cùng ranh giới khóa/giao dịch; không dựa vào dữ liệu đọc trước khóa.
- Snapshot và thay đổi catalog phải ghi dữ liệu cùng audit trong một transaction. Replay chỉ thành công khi payload thực sự tương đương.
- Dữ liệu từ worker và URL nhập vào phải bị từ chối có kiểm soát khi sai định dạng. Giữ RBAC hiện hành; không thêm PBAC hay organization.
- Sửa tối thiểu theo RED test; không thay đổi expectation hợp lệ để làm test xanh, không commit/push/PR nếu chưa được yêu cầu.

## Thứ tự triển khai

| Gói | Trạng thái | Lỗi / bằng chứng RED | Cách xử lý | Điều kiện nghiệm thu |
| --- | --- | --- | --- | --- |
| 1. Chốt trạng thái xóa nguồn | **DONE** | `CANCEL_REQUESTED` không chặn xóa; ca trong `legal-source-deletion.integration.spec.ts` | Dùng tập unresolved chuẩn cho impact và delete. | PostgreSQL deletion integration 10/10 PASS. |
| 2. Khóa activation và ingest | **DONE** | Hai ca mock trong `legal-source-race.red.spec.ts` và ca PostgreSQL chứng minh snapshot `Serializable` còn cũ sau khóa | Khóa version, đọc lại documents/index/attempt và dùng `ReadCommitted` cho activation. | PostgreSQL race/success integration 3/3 PASS; scoped regression 17/17 PASS. |
| 3. Snapshot nguyên tử và race | **TODO** | Hai ca trong `legal-source-audit.red.spec.ts` | Đưa `legalSourceSnapshot.create` và `auditWriter.write` vào cùng transaction. Khi `P2002` đúng khóa `snapshotRef`, đọc lại winner sau rollback và so sánh toàn bộ trường bất biến; sai payload trả 409, constraint khác vẫn ném lỗi gốc. | Audit fail không còn snapshot; hai request giống nhau hội tụ về một snapshot, khác payload không được replay. |
| 4. Catalog audit nguyên tử | **TODO** | Hai ca trong `legal-source-management-audit.red.spec.ts` | Đưa `createSource` + audit vào cùng transaction; phân loại unique slug đúng constraint trước khi retry. Với `updateSource`, ghi audit cùng transaction với update, gồm actor, correlation ID và thay đổi đã chấp nhận. | Audit fail rollback create/update; update thành công có audit. Không ghi audit cho thay đổi bị từ chối. |
| 5. Replay activation và index | **TODO** | Hai ca trong `legal-source-audit.red.spec.ts` | So sánh payload replay với bản ghi gốc: version, integrity/retrieval manifest, scope và các trường có ảnh hưởng nghiệp vụ; index so sánh cấu hình cùng content hash. Dùng phép chuẩn hóa đã được contract chấp thuận, không so sánh JSON tùy tiện. | Cùng key + cùng payload trả kết quả cũ; cùng key + payload khác trả 409, không tạo thêm event/index. |
| 6. Validation đầu vào | **TODO** | Hai ca worker snapshot trong `legal-source-audit.red.spec.ts`; ca `%ZZ` trong `safe-url-fetcher.service.spec.ts` | Bắt buộc URL hợp lệ và `documentIdentityVerified` là boolean thật tại boundary snapshot. Chuyển lỗi percent escape của `decodeURIComponent` thành `ImportRejectedError`/problem hợp lệ, không để `URIError` thô lọt ra. | Payload thiếu/sai bị từ chối trước DB write; URL lỗi không gây 500 ngoài ý muốn; URL hợp lệ giữ hành vi cũ. |

**Biên lai gói 1:** RED của ca `CANCEL_REQUESTED` đã được quan sát trên PostgreSQL test trước bản sửa. `LegalSourceDeletionService` hiện dùng `RULE_SET_PREPARATION_UNRESOLVED_STATES` của contracts, bao gồm `CANCEL_REQUESTED`, cho cả impact và delete. Chạy lại ca đích đạt 1/1 GREEN; toàn suite deletion integration đạt 10/10 PASS trên `127.0.0.1:55445/lcsp365_legal_source_deletion_test`. Typecheck, ESLint, business-logic-docs và `git diff --check` đạt. Không dùng `lcsp_local`.

**Biên lai gói 2:** Hai ca race mock đã RED trước sửa và GREEN sau khi activation khóa version rồi đọc lại corpus/index trong transaction, còn begin-ingestion đọc lại attempt sau version lock. Phát hiện thêm bằng PostgreSQL thật: ở isolation `Serializable`, snapshot đã được lấy từ truy vấn advisory lock trước khi chờ version row, nên activation vẫn ghi `ACTIVE` sau khi document bị xóa. Ca integration này RED với kết quả activation thành công sai; đổi riêng transaction activation sang `ReadCommitted` để truy vấn sau khóa thấy bản commit mới. Bộ PostgreSQL integration độc lập đạt **3/3** (activation race trả 409, ingestion race trả 409, activation hợp lệ thành công). Suite scoped không cần DB đạt 14/14. Nhóm E2E activation qua HTTP từng đạt 9/9 trên PostgreSQL tạm sau phần khóa/đọc lại; lần chạy lại toàn suite sau đổi isolation bị kẹt ở `pushPrismaSchema()` và timeout trước assertion, nên không ghi nhận một biên lai HTTP E2E mới cho phiên bản cuối. Core race và đường activation thành công đã được kiểm chứng trực tiếp trên DB test chuyên dụng `127.0.0.1:55446/lcsp_legal_source_race_test`; không dùng `lcsp_local`.

**Xác minh bổ sung còn mở:** Chạy lại HTTP E2E activation trên phiên bản cuối khi `pushPrismaSchema()` của harness không còn timeout. Mục này là **TODO** riêng; không được tính lần timeout là PASS.

## Quy trình cho từng gói

1. Chạy riêng RED test liên quan và ghi nhận đúng nguyên nhân thất bại; kiểm tra fixture/mocks nếu lỗi do setup.
2. Sửa production tối thiểu. Mọi hàm nghiệp vụ thay đổi phải có JSDoc năm phần và comment giải thích lý do, cơ chế, invariant.
3. Chạy lại test đó đến GREEN; chạy các suite hiện có của `legal-source` để kiểm tra hồi quy. Với race/transaction, thêm hoặc chạy PostgreSQL integration test trên DB test chuyên dụng để xác minh hiệu lực thật.
4. Review độc lập theo bốn góc: clean architecture, RBAC/BOLA và error masking, code quality, adversarial race/replay. Sửa tiếp nếu review tìm ra đường bypass.

## Cổng hoàn tất

- Toàn bộ 11 ca unit RED hiện có và ca deletion integration chuyển GREEN; các test cũ của module vẫn PASS. Hiện ca integration có guard DB nên phải cấu hình đúng test DB để thực sự chạy, không tính `skipped` là PASS.
- `pnpm --filter @lcsp/api exec tsc --noEmit`, ESLint trên file sửa, `pnpm run check:business-logic-docs`, `pnpm run test:business-logic-docs`, `pnpm run check:architecture`, `pnpm run check:imports` và `git diff --check` đều đạt.
- Kiểm tra API trả Result Envelope/RFC 7807 như hiện hành, không lộ lỗi Prisma hoặc URL nội bộ. Sau sửa code, chạy `graphify update .` và xác minh quan hệ quan trọng trực tiếp trong source/test.
- Chỉ dọn injection `CommandBus` không dùng nếu xác nhận không còn consumer và các cổng trên đã xanh; đây là cleanup, không phải lỗi nghiệp vụ cần chặn tiến độ.

## Lưu ý khi review

- RED test dùng mock kiểm tra thứ tự đọc/ghi là tín hiệu tốt nhưng không thay thế thử cạnh tranh trên PostgreSQL. Ưu tiên integration cho gói 1–4 trước khi coi race và transaction là đã đóng.
- Không chỉnh sửa hoặc reset các file dirty ngoài phạm vi. Kết quả cuối cùng phải báo riêng: root cause, fix, RED/GREEN receipt, test bị skip, rủi ro còn lại và danh sách file thay đổi.
