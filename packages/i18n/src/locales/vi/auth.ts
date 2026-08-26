import type { AuthMessages } from "../../types.ts";

export const viAuth = {
  errors: {
    authRequired: {
      title: "Cần đăng nhập",
      detail: "Bạn cần đăng nhập để tiếp tục.",
    },
    invalidCredentials: {
      title: "Không thể đăng nhập",
      detail: "Email hoặc mật khẩu không hợp lệ.",
    },
    invalidInviteState: {
      title: "Đường vào chưa sẵn sàng",
      detail: "Tài khoản chưa sẵn sàng cho đường vào đã phê duyệt.",
    },
    emailVerificationRequired: {
      title: "Cần xác minh email",
      detail: "Bạn cần xác minh email trước khi tiếp tục.",
    },
    sessionInvalid: {
      title: "Phiên không hợp lệ",
      detail: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
    },
    temporaryLock: {
      title: "Tài khoản tạm khóa",
      detail: "Tài khoản tạm thời bị khóa. Vui lòng thử lại sau.",
    },
    authzStateGateBlocked: {
      title: "Workspace đang bị chặn",
      detail: "Bạn chưa thể truy cập workspace này.",
    },
    authzEvaluatorFailure: {
      title: "Không thể xác minh truy cập",
      detail: "Không thể xác minh quyền truy cập lúc này.",
    },
    validationFailed: {
      title: "Yêu cầu không hợp lệ",
      detail: "Yêu cầu không hợp lệ.",
    },
    reauthRequired: {
      title: "Cần xác nhận lại quyền truy cập",
      detail:
        "Vui lòng xác nhận lại phiên đăng nhập trước khi thực hiện hành động này.",
    },
    mfaRequired: {
      title: "Cần xác thực hai bước",
      detail: "Bạn cần xác thực hai bước trước khi truy cập workspace.",
    },
    mfaInvalid: {
      title: "Mã xác thực không hợp lệ",
      detail: "Mã xác thực không hợp lệ hoặc đã hết hạn.",
    },
    mfaRateLimited: {
      title: "Quá nhiều lần thử",
      detail: "Quá nhiều lần thử thất bại. Vui lòng thử lại sau.",
    },
    recoveryInvalid: {
      title: "Liên kết khôi phục không hợp lệ",
      detail: "Liên kết khôi phục này không hợp lệ hoặc đã hết hạn.",
    },
    rbacDenied: {
      title: "Không có quyền thực hiện",
      detail: "Bạn không có quyền thực hiện hành động này.",
    },
    unsupportedProvider: {
      title: "Nhà cung cấp đăng nhập chưa hỗ trợ",
      detail: "Phương thức đăng nhập này chưa được hỗ trợ.",
    },
    invalidRedirectUri: {
      title: "Không thể đăng nhập",
      detail: "Yêu cầu đăng nhập không hợp lệ.",
    },
    oauthStateInvalid: {
      title: "Phiên đăng nhập đã hết hạn",
      detail: "Lượt đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
    },
    oauthCallbackInvalid: {
      title: "Không thể đăng nhập",
      detail: "Không thể hoàn tất đăng nhập. Vui lòng thử lại.",
    },
    accountNotFound: {
      title: "Tài khoản chưa được liên kết",
      detail:
        "Không có tài khoản nào được liên kết với phương thức đăng nhập này.",
    },
  },
} as const satisfies AuthMessages;
