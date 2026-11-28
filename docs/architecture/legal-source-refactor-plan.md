# Kế hoạch khắc phục module `legal-source`

Trạng thái: **đang triển khai** (28/11/2026). Gói 1 đã hoàn tất và xác minh trên PostgreSQL test; gói 2–6 chưa sửa production code. Phạm vi là các lỗi đã được tái hiện bằng RED test trong `apps/api/src/modules/legal-source/application/services`; giữ nguyên các thay đổi đang có ngoài module, đặc biệt hai file test Python đang dirty.

## Mục tiêu và ranh giới

- Xóa nguồn, kích hoạt phiên bản và bắt đầu ingest phải dùng trạng thái mới nhất dưới cùng ranh giới khóa/giao dịch; không dựa vào dữ liệu đọc trước khóa.
- Snapshot và thay đổi catalog phải ghi dữ liệu cùng audit trong một transaction. Replay chỉ thành công khi payload thực sự tương đương.
- Dữ liệu từ worker và URL nhập vào phải bị từ chối có kiểm soát khi sai định dạng. Giữ RBAC hiện hành; không thêm PBAC hay organization.
- Sửa tối thiểu theo RED test; không thay đổi expectation hợp lệ để làm test xanh, không commit/push/PR nếu chưa được yêu cầu.

## Thứ tự triển khai

| Gói | Lỗi / bằng chứng RED | Cách xử lý dự kiến | Điều kiện nghiệm thu |
| --- | --- | --- | --- |
| 1. Chốt trạng thái xóa nguồn | `CANCEL_REQUESTED` đang không chặn xóa; ca mới trong `legal-source-deletion.integration.spec.ts` | Dùng bộ trạng thái unresolved chuẩn của preparation thay cho danh sách thiếu trong `LegalSourceDeletionService`; áp dụng nhất quán cho impact và delete trong transaction. | Impact báo `nonterminalWorkExists`; delete từ chối khi run còn `CANCEL_REQUESTED`. Chạy trên DB **test chuyên dụng**, không dùng `lcsp_local`. |
| 2. Khóa activation và ingest | Hai ca trong `legal-source-race.red.spec.ts` | Sau khi lấy lifecycle/version lock, đọc lại documents, chunks, retrieval index và ingestion attempt từ transaction; kiểm tra lại toàn bộ điều kiện trước mutation. Giữ CAS trạng thái để bảo vệ concurrent writer. | Activation không thành công nếu document/index đã đổi; begin ingestion không ghi `PROCESSING` vào attempt mới dựa trên row cũ. Bổ sung integration race nếu mock chưa chứng minh được khóa DB thực. |
| 3. Snapshot nguyên tử và race | Hai ca trong `legal-source-audit.red.spec.ts` | Đưa `legalSourceSnapshot.create` và `auditWriter.write` vào cùng transaction. Khi `P2002` đúng khóa `snapshotRef`, đọc lại winner sau rollback và so sánh toàn bộ trường bất biến; sai payload trả 409, constraint khác vẫn ném lỗi gốc. | Audit fail không còn snapshot; hai request giống nhau hội tụ về một snapshot, khác payload không được replay. |
| 4. Catalog audit nguyên tử | Hai ca trong `legal-source-management-audit.red.spec.ts` | Đưa `createSource` + audit vào cùng transaction; phân loại unique slug đúng constraint trước khi retry. Với `updateSource`, ghi audit cùng transaction với update, gồm actor, correlation ID và thay đổi đã chấp nhận. | Audit fail rollback create/update; update thành công có audit. Không ghi audit cho thay đổi bị từ chối. |
| 5. Replay activation và index | Hai ca trong `legal-source-audit.red.spec.ts` | So sánh payload replay với bản ghi gốc: version, integrity/retrieval manifest, scope và các trường có ảnh hưởng nghiệp vụ; index so sánh cấu hình cùng content hash. Dùng phép chuẩn hóa đã được contract chấp thuận, không so sánh JSON tùy tiện. | Cùng key + cùng payload trả kết quả cũ; cùng key + payload khác trả 409, không tạo thêm event/index. |
| 6. Validation đầu vào | Hai ca worker snapshot trong `legal-source-audit.red.spec.ts`; ca `%ZZ` trong `safe-url-fetcher.service.spec.ts` | Bắt buộc URL hợp lệ và `documentIdentityVerified` là boolean thật tại boundary snapshot. Chuyển lỗi percent escape của `decodeURIComponent` thành `ImportRejectedError`/problem hợp lệ, không để `URIError` thô lọt ra. | Payload thiếu/sai bị từ chối trước DB write; URL lỗi không gây 500 ngoài ý muốn; URL hợp lệ giữ hành vi cũ. |

**Biên lai gói 1:** RED của ca `CANCEL_REQUESTED` đã được quan sát trên PostgreSQL test trước bản sửa. `LegalSourceDeletionService` hiện dùng `RULE_SET_PREPARATION_UNRESOLVED_STATES` của contracts, bao gồm `CANCEL_REQUESTED`, cho cả impact và delete. Chạy lại ca đích đạt 1/1 GREEN; toàn suite deletion integration đạt 10/10 PASS trên `127.0.0.1:55445/lcsp365_legal_source_deletion_test`. Typecheck, ESLint, business-logic-docs và `git diff --check` đạt. Không dùng `lcsp_local`.

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
