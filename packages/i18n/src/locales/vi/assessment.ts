import type { AssessmentMessages } from "../../types.ts";

export const viAssessment: AssessmentMessages = {
  activity: {
    factAccepted: "Thông tin đã được chấp nhận",
    ruleInvestigationStarted: "Đã bắt đầu điều tra quy tắc",
    rootStarted: "Đã bắt đầu đánh giá",
    taskStarted: "Đã bắt đầu nghiên cứu kho mã",
    taskFinished: "Đã hoàn tất nghiên cứu kho mã",
    modelStepCompleted: "Đã hoàn tất bước suy luận đánh giá",
    repositoryInspected: "Đã kiểm tra bằng chứng trong kho mã",
  },
  tracking: {
    reportReadyTitle: "Báo cáo cuối cùng đã sẵn sàng cho {name}",
    reportReadyDescription: "Báo cáo tuân thủ chuẩn hoá đã sẵn sàng để tải về.",
    reassessmentRequiredTitle: "Phát hiện commit mới cho {name}",
    reassessmentRequiredDescription: "Kho mã nguồn có commit mới hơn ({commit}) so với bản chụp đã đánh giá. Cần thực hiện đánh giá lại.",
    outcomeCompletedTitle: "Đã hoàn thành đánh giá cho {name}",
    outcomeCompletedDescription: "Đánh giá đã hoàn tất trên toàn bộ các quy tắc chuẩn.",
  },
};
