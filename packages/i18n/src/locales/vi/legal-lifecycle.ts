export const viLegalLifecycle = {
  versionDetail: "Chi tiết phiên bản nguồn luật",
  versionDescription:
    "Quản lý bản nháp và phiên bản đang hoạt động, giữ nguyên hồ sơ lịch sử.",
  draftManagement: "Quản lý bản nháp",
  draftNotice:
    "Thay đổi bản nháp không ảnh hưởng nguồn đang hoạt động. Thao tác phụ thuộc điều kiện hiện tại do máy chủ xác nhận.",
  reviewActivation: "Xem xét kích hoạt",
  readiness: "Điều kiện kích hoạt",
  documentsCheck: "Đã có tài liệu bắt buộc",
  processingCheck: "Tất cả tài liệu đã xử lý xong",
  indexCheck: "Chỉ mục cấu trúc hợp lệ",
  admissionCheck: "Phê duyệt nguồn luật Việt Nam chính thức",
  admissionMissing:
    "API chưa cung cấp phê duyệt theo LCSP-424/425. Chưa thể kích hoạt cho đến khi máy chủ xác nhận. Xử lý xong không đồng nghĩa với giá trị pháp lý đã được xác minh.",
  passed: "Đạt",
  blocked: "Bị chặn",
  refresh: "Làm mới trạng thái",
  refreshing: "Đang làm mới trạng thái…",
  identity: "Định danh nguồn / phiên bản",
  activeVersion: "Phiên bản đang hoạt động",
  basedOn: "Dựa trên phiên bản",
  notRecorded: "Máy chủ chưa cung cấp",
  purpose: "Mục đích tài liệu",
  operative: "Văn bản pháp luật chính",
  reference: "Chỉ dùng tham khảo bổ trợ",
  purposeHelp:
    "Mục đích quyết định cách dùng trong kho, không thay thế phê duyệt pháp lý. Chỉ văn bản pháp luật Việt Nam chính thức được dùng làm căn cứ quy phạm.",
  submitted:
    "Máy chủ đã tiếp nhận tài liệu. Xử lý và phê duyệt pháp lý là hai bước riêng biệt.",
  attempt: "Lần xử lý",
  hash: "SHA-256 nguồn",
  documentIdentity: "Định danh tài liệu",
  locatorHelp:
    "Xem các điều khoản để kiểm tra vị trí trang/điều/khoản/điểm và nguyên văn tiếng Việt.",
  officialProvenance: "Xuất xứ nguồn chính thức",
  provenanceMissing:
    "API quản lý chưa cung cấp số văn bản, cơ quan ban hành, mốc ngày đối chiếu và phê duyệt pháp lý. Không coi tài liệu này là căn cứ pháp lý đã xác minh.",
  impact: "Phạm vi xóa",
  preflight:
    "Chỉ là bản xem trước. Máy chủ kiểm tra lại quyền, tham chiếu, lưu giữ và bản chụp trong giao dịch xóa.",
  snapshot: "Thời điểm tạo bản chụp",
  documents: "Tài liệu",
  chunks: "Điều khoản",
  assessments: "Tham chiếu đánh giá",
  ruleSets: "Phiên bản bộ quy tắc",
  preparations: "Lượt chuẩn bị",
  snapshots: "Bản chụp độc lập được giữ lại",
  auditPreserved: "Bằng chứng kiểm toán được giữ lại.",
  deleted: "Đã xóa nguồn luật",
  receipt: "Biên nhận xóa",
  deletedAt: "Thời điểm xóa",
  returnToSources: "Quay lại danh sách nguồn luật",
  stale: "Trạng thái có thể đã thay đổi. Làm mới trước khi tiếp tục.",
  activationContext:
    "Đánh giá hiện có giữ nguyên phiên bản đã ghim. Chỉ thay thế phiên bản hoạt động sau khi máy chủ kiểm tra thành công.",
  discardContext:
    "Chỉ loại bỏ bản nháp đủ điều kiện này. Phiên bản hoạt động và lịch sử giữ nguyên.",
  sourceId: "ID nguồn",
  versionId: "ID phiên bản",
  fileInvalid: "Chọn tệp được hỗ trợ, có nội dung và không vượt quá 25 MB.",
} as const;
