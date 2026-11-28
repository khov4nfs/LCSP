# LCSP-402 · Nguồn luật Công báo Việt Nam

Thư mục này lưu nguyên bytes của chín PDF Công báo dùng để chuẩn bị nghiệm thu LCSP-402. [Manifest](manifest.json) ghi URL trang văn bản, URL PDF, số trang, số byte và SHA-256. [SHA256SUMS](SHA256SUMS) dùng để kiểm tra các bản gốc.

## Kết quả nghiệm thu kỹ thuật tại local

Đã đối chiếu SHA-256 của cả chín PDF và chạy hàm `ingest_document` của LCSP trực tiếp trên các bản gốc, với cấu hình `AUTO`. Parser chọn `ARTICLES` cho cả chín văn bản. Cả chín lần gọi trả `READY`, tổng cộng **369 trang, 2.678 chunks và 0 extraction gaps**. Đã kiểm tra số trang, SHA-256 văn bản trích xuất, SHA-256 từng chunk và tính duy nhất của locator trong từng văn bản. `READY` là kết quả parser chạy offline, chưa ghi vào Legal Source Version của ứng dụng.

| Văn bản | Trang | Chunks | Locator có hậu tố `dup` |
|---|---:|---:|---:|
| Luật 134/2025/QH15 | 20 | 212 | 0 |
| Luật 71/2025/QH15 | 31 | 308 | 0 |
| Nghị định 142/2026/NĐ-CP | 97 | 700 | 137 |
| Quyết định 33/2026/QĐ-TTg | 16 | 13 | 0 |
| Thông tư 05/2026/TT-BKHCN | 9 | 48 | 11 |
| Quyết định 1671/QĐ-TTg | 64 | 274 | 79 |
| Luật 91/2025/QH15 | 25 | 273 | 0 |
| Nghị định 356/2025/NĐ-CP | 70 | 403 | 24 |
| Luật 116/2025/QH15 | 37 | 447 | 0 |

251 locator mang hậu tố phân biệt các heading lặp. Khi chọn trích dẫn cho gold, cần đối chiếu locator thuộc nhóm này với trang PDF, cấu trúc điều khoản và phụ lục. [Receipt](ingestion-receipt.json) ghi hash bản gốc, hash văn bản trích xuất, phiên bản parser và hash từng kết quả ingest. Các kết quả đầy đủ được lưu local trong `output/lcsp-402-ingestion/`.

230 test thuộc sáu suite về managed-document ingest, document representation, XTRAREG, Direct Draft, reviewed gate và Preparation semantic oracle đã pass tại commit `6a34888dfe1d0d47d2a25dd9944fcf8abb459146`.

## Nghiệm thu research

**BLOCKED.** Cần ít nhất 30 gold annotations nguyên tử được review độc lập theo [LCSP-400](https://minhpnq1807.atlassian.net/browse/LCSP-400), có citation bám phiên bản nguồn và holdout đã chốt. Cần hai output và manifest từ workflow Preparation và Direct Draft thực tế trên cùng nguồn và model. Chưa đo semantic gain. Bộ [GDPR synthetic](../../reports/xtrareg-gdpr-v1/report.md) tiếp tục dùng để kiểm thử diagnostic scorer.
