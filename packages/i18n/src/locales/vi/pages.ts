import type { PagesMessages } from "../../types.ts";
export const viPages = {
  appShell: {
    productName: "LCSP",
    productTagline: "Vận hành tuân thủ",
    mobileTitle: "Workspace LCSP",
    mobileDescription: "Điều hướng assessment và quy trình tuân thủ.",
    sidebarToggle: "Ẩn hiện điều hướng workspace",
    headerEyebrow: "Workspace tuân thủ",
    workspaceTitle: "Tổng quan workspace",
    assessmentTitle: "Quy trình assessment",
    developerTitle: "Tác vụ Developer",
    workspaceNavigation: "Workspace",
    assessmentNavigation: "Assessment hiện tại",
    chooseAssessmentToView: "Chọn assessment để xem",
    selectAssessmentFirst: "Vui lòng chọn assessment của bạn trước.",
    developerNavigation: "Developer",
    overview: "Tổng quan",
    assessments: "Assessment",
    recentAssessments: "Assessment gần đây",
    moreAssessments: "Thêm assessment",
    allAssessments: "Tất cả assessment",
    searchAssessments: "Tìm assessment",
    noAssessmentMatches: "Không tìm thấy assessment phù hợp.",
    settings: "Cài đặt",
    wizard: "Wizard intake",
    readiness: "Readiness",
    technicalEvidence: "Bằng chứng kỹ thuật",
    classification: "Classification",
    documents: "Tài liệu",
    conflicts: "Xử lý xung đột",
    developer: "Phát hiện kỹ thuật",
    developers: "Developer",
    legalLibrary: "Luật",
    secureWorkspace: "Workspace tổ chức được bảo vệ",
    signOut: "Đăng xuất",
    switchWorkspace: "Đổi workspace",
    currentWorkspace: "Workspace hiện tại",
    switchingWorkspace: "Đang chuyển workspace",
    workspaceMenuTitle: "Chuyển workspace",
    authEyebrow: "Quản trị rõ ràng, không phỏng đoán",
    authTitle: "Đưa mọi assessment AI tiến về phía trước bằng evidence.",
    authDescription:
      "LCSP tập trung intake, readiness, classification và review trong một workspace được kiểm soát.",
    runtimePanelTitle: "Hoạt động runtime",
    runtimePanelAwaiting: "Đang chờ hoạt động runtime",
    runtimePanelLastUpdated: "Cập nhật lần cuối",
    runtimePanelActiveTools: "Tool đang chạy",
    runtimePanelRecentActivity: "Hoạt động gần đây",
    runtimePanelEmpty: "Assessment này chưa có hoạt động runtime.",
    runtimePanelViewFull: "Xem runtime đầy đủ",
    runtimePanelStatuses: {
      running: "Đang chạy",
      waiting: "Đang chờ",
      completed: "Hoàn tất",
      failed: "Thất bại",
    },
    runtimePanelStages: {
      snapshot: "Snapshot",
      scan: "Scan",
      technicalEvidence: "Bằng chứng kỹ thuật",
      technicalProfile: "Technical profile",
      aiUsageFlow: "AI usage flow",
      reconciliation: "Đối soát",
      classification: "Classification",
      conflicts: "Xung đột",
      documents: "Tài liệu",
      legalRetrieval: "Truy xuất pháp lý",
    },
    runtimePanelConnection: {
      connected: "Đã kết nối",
      connecting: "Đang kết nối",
      disconnected: "Mất kết nối",
    },
    runtimePanelEvents: {
      runStarted: "Run bắt đầu",
      runStageChanged: "Chuyển stage",
      toolStarted: "Tool bắt đầu",
      toolCompleted: "Tool hoàn tất",
      toolFailed: "Tool thất bại",
      toolWaitingInput: "Đang chờ input",
      toolSkipped: "Bỏ qua tool",
      runCompleted: "Run hoàn tất",
      runFailed: "Run thất bại",
    },
  },
  signIn: {
    metadataTitle: "Đăng nhập | LCSP",
    metadataDescription: "Truy cập không gian làm việc tuân thủ LCSP.",
    homeAriaLabel: "Trang chủ",
    formEyebrow: "Truy cập an toàn",
    formTitle: "Đăng nhập",
    formDescription: "Dùng tài khoản tổ chức đã được phê duyệt của bạn.",
    emailLabel: "Email công việc",
    emailDescription: "Nhập địa chỉ email được liên kết với tổ chức của bạn.",
    passwordLabel: "Mật khẩu",
    passwordDescription:
      "Không lưu mật khẩu này trên trình duyệt khi dùng thiết bị dùng chung.",
    submit: "Đăng nhập",
    submitting: "Đang kiểm tra quyền truy cập",
    divider: "Khác",
    oauthGoogle: "Google",
    oauthGitHub: "GitHub",
    accessHelp: "Cần quyền truy cập? Hãy liên hệ chủ sở hữu tổ chức.",
    forgotPassword: "Quên mật khẩu?",
    errors: {
      emailRequired: "Nhập email công việc của bạn.",
      emailInvalid: "Nhập email công việc hợp lệ.",
      passwordRequired: "Nhập mật khẩu của bạn.",
      requestFailedTitle: "Không thể đăng nhập",
      requestFailedDetail: "Không thể đăng nhập. Vui lòng thử lại.",
      retryAtLabel: "Bạn có thể thử lại lúc",
    },
  },
  mfaVerify: {
    metadataTitle: "Xác minh danh tính | LCSP",
    metadataDescription: "Hoàn tất xác minh đa yếu tố để tiếp tục.",
    homeAriaLabel: "Trang chủ",
    formEyebrow: "Xác minh bảo mật",
    formTitle: "Nhập mã xác minh",
    formDescription: "Dùng mã sáu chữ số từ ứng dụng xác thực của bạn.",
    otpLabel: "Mã xác minh",
    otpDescription: "Nhập mã sáu chữ số hiện tại.",
    moreOptions: "Tùy chọn khác",
    useAuthenticator: "Dùng ứng dụng xác thực",
    recoveryCodeTitle: "Nhập mã khôi phục",
    recoveryCodeDescription:
      "Dùng một mã khôi phục chưa sử dụng trong bộ mã MFA đã lưu.",
    recoveryCodeLabel: "Mã khôi phục",
    recoveryCodePlaceholder: "ABCD-EFGH-IJKL",
    recoveryCodeHelp: "Mỗi mã khôi phục chỉ dùng được một lần.",
    recoveryCodeSubmit: "Xác minh mã khôi phục",
    submit: "Xác minh mã",
    submitting: "Đang xác minh mã",
    accessHelp: "Cần trợ giúp? Hãy liên hệ chủ sở hữu tổ chức.",
    useRecovery: "Không dùng được ứng dụng xác thực? Khôi phục quyền truy cập.",
    errors: {
      otpRequired: "Nhập mã xác minh của bạn.",
      otpInvalidFormat: "Nhập mã xác minh gồm sáu chữ số.",
      recoveryCodeRequired: "Nhập mã khôi phục.",
      recoveryCodeInvalidFormat: "Nhập mã khôi phục hợp lệ.",
      requestFailedTitle: "Không thể xác minh",
      requestFailedDetail: "Không thể xác minh mã. Vui lòng thử lại.",
    },
  },
  mfaEnroll: {
    metadataTitle: "Thiết lập MFA | LCSP",
    metadataDescription: "Thiết lập ứng dụng xác thực trước khi vào workspace.",
    homeAriaLabel: "Trang chủ",
    formEyebrow: "Thiết lập bảo mật",
    formTitle: "Bật xác thực hai bước",
    formDescription:
      "Tạo cấu hình ứng dụng xác thực rồi quay lại bước xác minh mã.",
    submit: "Tạo cấu hình MFA",
    submitting: "Đang tạo cấu hình MFA",
    goToVerify: "Tôi đã có mã, chuyển sang xác minh",
    accessHelp:
      "Luồng này không thay đổi quyền truy cập của bạn, chỉ hoàn tất lớp bảo vệ bắt buộc.",
    successTitle: "Đã tạo cấu hình MFA",
    successDetail:
      "Mở URI này bằng ứng dụng xác thực của bạn, sau đó tiếp tục sang bước xác minh mã.",
    copyCodes: "Sao chép",
    downloadCodes: "Tải xuống",
    printCodes: "In",
    openAuthenticator: "Mở trong ứng dụng xác thực",
    qrTitle: "Quét mã QR này bằng ứng dụng xác thực",
    qrHint:
      "Nếu thiết bị này không mở được ứng dụng xác thực, hãy dùng điện thoại để quét mã QR này.",
    qrAlt: "Mã QR để thiết lập ứng dụng xác thực MFA cho LCSP",
    qrLoading: "Đang tạo mã QR cho ứng dụng xác thực.",
    errors: {
      requestFailedTitle: "Không thể thiết lập MFA",
      requestFailedDetail: "Không thể tạo cấu hình MFA lúc này.",
    },
  },
  recoveryRequest: {
    metadataTitle: "Khôi phục mật khẩu | LCSP",
    metadataDescription: "Yêu cầu liên kết khôi phục mật khẩu an toàn.",
    homeAriaLabel: "Trang chủ",
    formEyebrow: "Khôi phục truy cập",
    formTitle: "Yêu cầu khôi phục mật khẩu",
    formDescription:
      "Nhập email công việc của bạn để bắt đầu luồng khôi phục an toàn.",
    emailLabel: "Email công việc",
    emailDescription: "Sử dụng email đã liên kết với tài khoản LCSP của bạn.",
    submit: "Gửi yêu cầu khôi phục",
    submitting: "Đang gửi yêu cầu khôi phục",
    backToSignIn: "Quay lại đăng nhập",
    successTitle: "Yêu cầu đã được ghi nhận",
    successDetail:
      "Nếu email tồn tại trong hệ thống, hướng dẫn khôi phục sẽ được gửi qua kênh phù hợp.",
    errors: {
      emailRequired: "Nhập email công việc của bạn.",
      emailInvalid: "Nhập email công việc hợp lệ.",
      requestFailedTitle: "Không thể gửi yêu cầu",
      requestFailedDetail: "Không thể gửi yêu cầu khôi phục lúc này.",
    },
  },
  recoveryConfirm: {
    metadataTitle: "Đặt lại mật khẩu | LCSP",
    metadataDescription: "Xác nhận yêu cầu khôi phục và đặt mật khẩu mới.",
    homeAriaLabel: "Trang chủ",
    formEyebrow: "Hoàn tất khôi phục",
    formTitle: "Đặt mật khẩu mới",
    formDescription:
      "Dùng token khôi phục hợp lệ để đặt lại mật khẩu và thu hồi các phiên cũ.",
    tokenLabel: "Token khôi phục",
    tokenDescription: "Dán token hoặc liên kết khôi phục đã nhận.",
    passwordLabel: "Mật khẩu mới",
    passwordDescription: "Sử dụng ít nhất 12 ký tự.",
    submit: "Xác nhận khôi phục",
    submitting: "Đang cập nhật mật khẩu",
    requestAnother: "Yêu cầu liên kết khôi phục khác",
    errors: {
      tokenRequired: "Nhập token khôi phục.",
      passwordTooShort: "Mật khẩu phải có ít nhất 12 ký tự.",
      requestFailedTitle: "Không thể khôi phục mật khẩu",
      requestFailedDetail: "Không thể hoàn tất khôi phục lúc này.",
    },
  },
  acceptInvitation: {
    metadataTitle: "Chấp nhận lời mời Developer | LCSP",
    metadataDescription:
      "Xem và chấp nhận lời mời Developer có giới hạn phạm vi.",
    eyebrow: "Quyền truy cập Developer",
    title: "Chấp nhận lời mời của bạn",
    description: "Kiểm tra quyền được cấp trước khi tạo tài khoản.",
    loading: "Đang tải thông tin lời mời",
    organizationScope: "Quyền truy cập trong phạm vi tổ chức",
    expiresLabel: "Lời mời hết hạn",
    displayNameLabel: "Tên hiển thị",
    displayNameDescription: "Nhập tên đồng đội sẽ thấy (1–100 ký tự).",
    passwordLabel: "Mật khẩu",
    passwordDescription: "Sử dụng ít nhất 12 ký tự.",
    submit: "Chấp nhận lời mời",
    submitting: "Đang tạo tài khoản",
    signInInstead: "Đăng nhập thay thế.",
    errors: {
      displayNameRequired: "Nhập tên hiển thị của bạn.",
      displayNameTooLong: "Tên hiển thị không được quá 100 ký tự.",
      passwordTooShort: "Mật khẩu phải có ít nhất 12 ký tự.",
      invalidTitle: "Lời mời không khả dụng",
      invalidDetail:
        "Liên kết lời mời này không còn hợp lệ. Hãy yêu cầu chủ sở hữu tổ chức gửi lời mời mới.",
      emailExistsTitle: "Tài khoản đã tồn tại",
      emailExistsDetail: "Email này đã có tài khoản.",
      requestTitle: "Không thể chấp nhận lời mời",
      requestDetail: "Không thể chấp nhận lời mời. Vui lòng thử lại.",
    },
  },
  developerTask: {
    metadataTitle: "Workspace tác vụ Developer | LCSP",
    metadataDescription: "Xem các phát hiện kỹ thuật đã ẩn dữ liệu được giao.",
    sidebarTitle: "Workspace Developer",
    sidebarDescription: "Điều hướng tác vụ Developer",
    sidebarToggle: "Ẩn hiện điều hướng tác vụ Developer",
    navigationLabel: "Tác vụ Developer",
    taskNav: "Phát hiện kỹ thuật",
    pageTitle: "Workspace tác vụ theo phạm vi",
    pageDescription:
      "Xem các phát hiện kỹ thuật đã ẩn dữ liệu được giao cho bạn.",
    selectionTitle: "Chọn assessment",
    selectionDescription:
      "Mở assessment trong phạm vi tổ chức hiện tại của bạn.",
    openAssessment: "Mở phát hiện kỹ thuật",
    loading: "Đang tải tác vụ",
    scopeTitle: "Phạm vi truy cập của bạn",
    scopeDescription: "Phạm vi này do chủ sở hữu tổ chức kiểm soát.",
    organization: "Tổ chức",
    assessment: "Assessment",
    organizationScope: "Phạm vi tổ chức",
    grantedActions: "Hành động được cấp",
    hiddenBoundaryTitle: "Thông tin được bảo vệ vẫn bị ẩn",
    hiddenBoundary:
      "Bạn không thể xem: mã nguồn, đường dẫn tệp, số dòng hoặc hành động chỉ dành cho Manager.",
    findingsTitle: "Phát hiện kỹ thuật đã ẩn dữ liệu",
    findingsDescription:
      "Chỉ các chi tiết được phạm vi hiện tại cho phép mới được hiển thị.",
    emptyTitle: "Chưa có phát hiện kỹ thuật cho assessment này.",
    emptyDescription: "Hãy quay lại sau khi bằng chứng kỹ thuật được xử lý.",
    revokedTitle: "Quyền truy cập đã bị thu hồi",
    revokedDetail: "Quyền truy cập của bạn vào tác vụ này đã bị thu hồi.",
    errorTitle: "Tác vụ không khả dụng",
    errorDetail: "Hiện không thể tải tác vụ này. Vui lòng thử lại.",
    actions: {
      assessmentList: "Duyệt assessment được giao",
      evidenceReadRedacted: "Xem phát hiện kỹ thuật đã ẩn dữ liệu",
      aiUsageFlowRead: "Xem luồng sử dụng AI",
      findingsReadRedacted: "Xem xét phát hiện đã ẩn dữ liệu",
      conflictComment: "Bình luận về xung đột",
      scanRead: "Xem trạng thái scan",
    },
  },
  workspace: {
    metadataTitle: "Workspace | LCSP",
    metadataDescription: "Quản lý workspace tổ chức đang hoạt động.",
    productName: "LCSP",
    sidebarTitle: "Workspace",
    sidebarDescription: "Điều hướng workspace",
    sidebarToggle: "Ẩn hiện điều hướng workspace",
    pageTitle: "Bảng điều khiển workspace",
    pageDescription:
      "Xem ngữ cảnh tổ chức, hành động workspace được cấp và các assessment đang hoạt động.",
    organizationLabel: "Tổ chức",
    membershipRoleLabel: "Vai trò thành viên",
    navigationLabel: "Điều hướng workspace",
    overviewNav: "Tổng quan",
    assessmentsNav: "Assessment",
    documentsNav: "Tài liệu",
    createAssessment: "Tạo Assessment",
    newAssessmentName: "Assessment mới",
    openConflictResolution: "Mở xử lý xung đột",
    openWizard: "Mở Wizard",
    assessmentsTitle: "Assessment",
    assessmentsDescription:
      "Theo dõi tiến độ assessment từ wizard intake đến review.",
    overviewAssessmentsTitle: "Quản lý assessment",
    overviewAssessmentsDescription:
      "Mở danh sách đầy đủ để theo dõi tiến độ và tiếp tục từng assessment.",
    openAssessments: "Mở danh sách assessment",
    insightsTitle: "Tổng quan assessment",
    totalAssessments: "Tổng số assessment",
    needsAttention: "Cần tiếp tục xử lý",
    readyForReview: "Sẵn sàng review",
    recentAssessmentsTitle: "Assessment gần đây",
    recentAssessmentsDescription:
      "Mở nhanh các assessment được tạo gần đây hoặc xem toàn bộ danh sách.",
    settingsTitle: "Cài đặt tài khoản",
    settingsDescription:
      "Quản lý MFA, khôi phục truy cập và luồng bảo vệ tài khoản bên ngoài màn tổng quan workspace.",
    emptyTitle: "Chưa có assessment",
    emptyDescription: "Tạo assessment đầu tiên của bạn.",
    loadingAssessments: "Đang tải assessment",
    statusLabel: "Trạng thái",
    wizardStatusLabel: "Trạng thái wizard",
    createdAtLabel: "Ngày tạo",
    progressLabel: "Tiến độ assessment",
    statuses: {
      WIZARD_IN_PROGRESS: "Đang thực hiện",
      WIZARD_SUBMITTED: "Wizard hoàn tất",
      EVIDENCE_REQUIRED: "Cần evidence",
      SCAN_IN_PROGRESS: "Đang scan",
      CLASSIFICATION_LOCKED: "Classification đã khóa",
      READY_FOR_REVIEW: "Sẵn sàng review",
    },
    wizardStatuses: {
      NOT_STARTED: "Chưa bắt đầu",
      IN_PROGRESS: "Đang thực hiện",
      SUBMITTED: "Đã gửi",
    },
    nextActions: {
      wizardNotStarted:
        "Bắt đầu Wizard để mô tả cách hệ thống AI được sử dụng.",
      wizardInProgress: "Tiếp tục Wizard để hoàn thành assessment.",
      wizardSubmitted:
        "Đang chờ bằng chứng kỹ thuật trước khi có thể phân loại.",
    },
    security: {
      title: "Bảo vệ tài khoản",
      description:
        "Thiết lập MFA, cập nhật email khôi phục và dùng đúng các luồng an toàn đã được backend hỗ trợ.",
      openMfaEnroll: "Thiết lập MFA",
      openRecovery: "Mở khôi phục mật khẩu",
      recoveryEmailLabel: "Email khôi phục",
      recoveryEmailDescription:
        "Thêm hoặc thay đổi email khôi phục mà không hiển thị secret trong UI.",
      submit: "Lưu cài đặt khôi phục",
      submitting: "Đang lưu cài đặt khôi phục",
      successTitle: "Đã cập nhật cài đặt an toàn",
      successDetail:
        "Thông tin khôi phục đã được lưu và audit theo flow bảo mật hiện tại.",
      errors: {
        recoveryEmailInvalid: "Nhập email khôi phục hợp lệ hoặc để trống.",
        requestFailedTitle: "Không thể cập nhật cài đặt",
        requestFailedDetail:
          "Không thể cập nhật cài đặt an toàn lúc này. Vui lòng thử lại.",
      },
    },
    settingsHub: {
      description:
        "Quản lý định danh tài khoản, MFA, khôi phục, phiên đăng nhập và repository đã liên kết theo đúng flow bảo mật hiện tại của LCSP.",
      sections: {
        account: "Tài khoản",
        appearance: "Giao diện",
        notifications: "Thông báo",
        emails: "Email",
        passwordAndAuthentication: "Mật khẩu và xác thực",
        sessions: "Phiên đăng nhập",
        repositories: "Repository",
      },
      labels: {
        account: "Tài khoản",
        displayName: "Tên hiển thị",
        primaryEmail: "Email chính",
        organization: "Tổ chức",
        membershipRole: "Vai trò thành viên",
        createdAt: "Ngày tạo",
        updatedAt: "Cập nhật",
        recoveryEmail: "Email khôi phục",
        lastActiveAt: "Hoạt động gần nhất",
        expiresAt: "Hết hạn",
        defaultBranch: "Nhánh mặc định",
        linkedAssessment: "Assessment liên kết",
        connectedAt: "Đã liên kết",
      },
      badges: {
        verified: "Đã xác minh",
        unverified: "Chưa xác minh",
        mfaEnabled: "MFA đã bật",
        mfaPending: "MFA đang chờ",
        configured: "Đã cấu hình",
        primary: "Chính",
        backup: "Dự phòng",
        active: "Đang hoạt động",
        revoked: "Đã thu hồi",
      },
      states: {
        notConfigured: "Chưa cấu hình",
        noRecoveryEmail: "Chưa có email khôi phục",
        enabled: "Bật",
        disabled: "Tắt",
        currentSession: "Phiên hiện tại",
        noSessions: "Không có phiên đăng nhập.",
        noRepositories: "Chưa có repository liên kết.",
        noAssessmentLinked: "Chưa liên kết assessment",
      },
      actions: {
        edit: "Chỉnh sửa",
        manage: "Quản lý",
        setUp: "Thiết lập",
        hide: "Ẩn",
        changePassword: "Đổi mật khẩu",
        turnOn: "Bật MFA",
        turnOff: "Tắt MFA",
        generateSetup: "Tạo cấu hình",
        verifyAndSave: "Xác minh và lưu",
        cancel: "Hủy",
        sendRecovery: "Gửi hướng dẫn khôi phục",
        updatePassword: "Cập nhật mật khẩu",
        revoke: "Thu hồi",
        linkGitHub: "Liên kết GitHub",
        linkGoogle: "Liên kết Google",
        connectGitHubRepository: "Kết nối GitHub repository",
        manageGitHubRepositoryAccess: "Quản lý quyền",
      },
      account: {
        title: "Tài khoản",
        description:
          "Xem định danh và ngữ cảnh workspace gắn với phiên LCSP hiện tại.",
        oauthTitle: "Nhà cung cấp OAuth",
        oauthDescription:
          "Chỉ thêm phương thức đăng nhập OAuth sau khi phiên hiện tại đã xác thực hợp lệ.",
        oauthLinkSuccessTitle: "Đã liên kết provider",
        oauthLinkSuccessDescription:
          "Provider OAuth này có thể dùng cho các lần đăng nhập LCSP sau.",
        oauthLinkFailedTitle: "Chưa liên kết provider",
        oauthLinkFailedDescription:
          "Không thể liên kết provider OAuth với tài khoản này.",
      },
      appearance: {
        title: "Giao diện",
        description:
          "Giữ bố cục kiểu GitHub nhưng vẫn dùng hệ giao diện hiện tại của LCSP.",
        shellTitle: "Shell hiện tại",
        shellDescription:
          "Giao diện đang bám theo shell workspace hiện tại của LCSP. Tùy chọn theme theo tài khoản chưa được lưu riêng.",
      },
      notifications: {
        title: "Thông báo",
        description:
          "Xem các email nào đang nhận thông báo khôi phục và bảo mật trong hệ thống hiện tại.",
        emailRoutingTitle: "Điều hướng email",
        emailRoutingDescription:
          "Thông báo khôi phục và bảo mật dùng email chính cùng email khôi phục tùy chọn ở bên dưới.",
      },
      emails: {
        title: "Email",
        description:
          "Quản lý các email dùng để đăng nhập, nhận thông báo và khôi phục truy cập.",
        addressListTitle: "Các email có thể sử dụng",
        addressListDescription:
          "Các email đã xác minh có thể dùng để đăng nhập và nhận thông báo bảo mật trong flow LCSP hiện tại.",
        primaryTitle: "Email chính",
        primaryDescription:
          "Email chính được dùng để đăng nhập và nhận thông báo bảo mật.",
        primaryRowDescription:
          "Địa chỉ này là đích mặc định cho đăng nhập và các hoạt động bảo mật tài khoản.",
        recoveryRowDescription:
          "Địa chỉ này hiện được lưu làm email dự phòng cho khôi phục và thông báo bảo mật.",
        primaryMenuLabel: "Mở hành động cho email chính",
        recoveryMenuLabel: "Mở hành động cho email dự phòng",
        addEmailTitle: "Thêm địa chỉ email",
        addEmailInputLabel: "Địa chỉ email",
        addEmailPlaceholder: "Địa chỉ email",
        addEmailAction: "Thêm",
        addEmailDescription:
          "LCSP hiện lưu một email khôi phục bổ sung để phục vụ khôi phục tài khoản và thông báo bảo mật.",
        primaryPreferenceTitle: "Địa chỉ email chính",
        primaryPreferenceDescription:
          "Chọn email dùng cho thông báo liên quan tới tài khoản và làm định danh khôi phục mặc định.",
        backupPreferenceTitle: "Địa chỉ email dự phòng",
        backupPreferenceDescription:
          "Chọn cách email dự phòng được dùng cho các sự kiện khôi phục và bảo mật.",
        backupAllVerifiedOption: "Cho phép tất cả email đã xác minh",
      },
      reauth: {
        title: "Xác nhận truy cập",
        description:
          "Xác nhận thay đổi cài đặt nhạy cảm này trước khi tiếp tục.",
        accountLabel: "Đăng nhập với",
        passwordPlaceholder: "Mật khẩu",
        otpPlaceholder: "XXXXXX",
        confirm: "Xác nhận",
        confirming: "Đang xác nhận",
        verify: "Xác minh",
        verifying: "Đang xác minh",
        supportTitle: "Gặp sự cố?",
        useAuthenticator: "Dùng ứng dụng xác thực",
        usePassword: "Dùng mật khẩu",
        setUpMfa: "Thiết lập MFA",
        close: "Đóng hộp thoại",
      },
      password: {
        title: "Mật khẩu và xác thực",
        description:
          "Quản lý phương thức đăng nhập, MFA bằng ứng dụng xác thực và luồng khôi phục hiện được LCSP hỗ trợ.",
        signInMethodsTitle: "Phương thức đăng nhập",
        emailMethod: "Email",
        emailMethodDescription: "Đã cấu hình 2 email xác minh",
        passwordMethod: "Mật khẩu",
        passwordMethodDescription: "Đã cấu hình",
        currentPasswordLabel: "Mật khẩu cũ",
        newPasswordLabel: "Mật khẩu mới",
        confirmNewPasswordLabel: "Xác nhận mật khẩu mới",
        passwordPolicyHint:
          "Đảm bảo mật khẩu có ít nhất 15 ký tự HOẶC ít nhất 8 ký tự bao gồm một số và một chữ cái viết thường.",
        learnMoreLink: "Tìm hiểu thêm",
        mfaTitle: "Xác thực hai bước",
        mfaDescription:
          "Thiết lập ứng dụng xác thực là bắt buộc trước khi vào workspace được bảo vệ.",
        authenticatorApp: "Ứng dụng xác thực",
        authenticatorConfigured:
          "Tài khoản này đã cấu hình ứng dụng xác thực TOTP.",
        authenticatorPending:
          "Hãy tạo cấu hình mới và xác minh một mã để hoàn tất enroll.",
        inlineSetupTitle: "Thiết lập ứng dụng xác thực",
        inlineSetupDescription:
          "Tạo mã QR, quét bằng ứng dụng xác thực rồi xác minh ngay một mã hiện tại.",
        mfaVerifiedTitle: "Đã xác minh xác thực hai bước",
        mfaDisabledTitle: "Đã tắt xác thực hai bước",
        disableFailedTitle: "Không thể tắt xác thực hai bước",
        disableFailedDescription:
          "Phiên hiện tại chưa thể tắt MFA lúc này. Hãy xác thực lại rồi thử lại.",
        recoveryTitle: "Tùy chọn khôi phục",
        recoveryDescription:
          "Gửi hướng dẫn khôi phục theo đúng luồng khôi phục mật khẩu hiện tại của LCSP khi cần đặt lại truy cập.",
      },
      sessions: {
        title: "Phiên đăng nhập",
        description:
          "Xem các phiên đã xác thực trong phạm vi workspace hiện tại.",
        activeTitle: "Phiên web",
        activeDescription:
          "Thu hồi các phiên bạn không còn nhận ra mà không thay đổi layout workspace hiện tại.",
        summary: "Phiên đang hoạt động",
        revokedTitle: "Đã thu hồi phiên",
      },
      repositories: {
        title: "Repository",
        description:
          "Xem các repository đã liên kết với tài khoản này thông qua tích hợp GitHub hiện tại của LCSP.",
        connectTitle: "Kết nối GitHub App",
        connectDescription:
          "Bắt đầu flow GitHub App read-only và chọn repository được ủy quyền cho bằng chứng scan tin cậy.",
        connectSuccessTitle: "Đã kết nối repository",
        connectSuccessDescription:
          "LCSP đã lưu metadata repository mà không lưu raw GitHub token.",
        connectFailedTitle: "Kết nối repository thất bại",
        connectFailedDescription:
          "Không thể hoàn tất ủy quyền GitHub App cho workspace này.",
        listTitle: "Repository đã liên kết",
        listDescription:
          "Mỗi repository được hiển thị cạnh assessment đang sử dụng nó.",
        summary: "Repository đã liên kết",
      },
      errors: {
        profileLoadTitle: "Không thể tải cài đặt",
        profileLoadDetail:
          "Hiện không thể tải dữ liệu cài đặt tài khoản. Vui lòng thử lại.",
        sessionActionDetail:
          "Không thể hoàn tất thao tác với phiên lúc này. Vui lòng thử lại.",
      },
    },
    errors: {
      workspaceUnavailableTitle: "Workspace chưa khả dụng",
      workspaceUnavailableDetail: "Hiện không thể tải ngữ cảnh workspace.",
      assessmentsUnavailableTitle: "Assessment chưa khả dụng",
      assessmentsUnavailableDetail: "Hiện không thể tải danh sách assessment.",
      createAssessmentTitle: "Không thể tạo assessment",
      createAssessmentDetail: "Vui lòng thử lại.",
    },
  },
  assessment: {
    eyebrow: "Quy trình assessment",
    pageTitle: "Tổng quan assessment",
    pageDescription:
      "Mở đúng bước trong quy trình để hoàn thiện intake, kiểm tra readiness, phân loại và hồ sơ tuân thủ.",
    openOverview: "Mở tổng quan assessment",
    moduleNavigation: "Các bước assessment",
    openModule: "Mở bước này",
    modules: {
      wizard: "Khai báo bối cảnh nghiệp vụ và cách hệ thống AI được sử dụng.",
      readiness: "Kiểm tra các điều kiện đã sẵn sàng và evidence còn thiếu.",
      classification:
        "Xem trạng thái phân loại và các hành động có thể tiếp tục.",
      documents: "Tạo, theo dõi và tải các tài liệu assessment.",
      conflicts: "Xem xét và ghi nhận quyết định cho các xung đột đang chờ.",
    },
  },
  assessmentForm: {
    pageTitle: "Tạo assessment",
    pageDescription: "Nhập thông tin cơ bản trước khi bắt đầu Wizard intake.",
    formTitle: "Thông tin assessment",
    formDescription: "Bạn có thể bổ sung chi tiết trong các bước tiếp theo.",
    nameLabel: "Tên assessment",
    namePlaceholder: "Ví dụ: Trợ lý hỗ trợ khách hàng AI",
    descriptionLabel: "Mô tả",
    descriptionPlaceholder: "Mô tả ngắn về hệ thống AI cần đánh giá.",
    cancel: "Hủy",
    submit: "Tạo và bắt đầu Wizard",
    submitting: "Đang tạo assessment",
  },
  developerManagement: {
    pageTitle: "Quản lý Developer",
    pageDescription:
      "Cấp và thu hồi quyền Developer theo phạm vi assessment hiện tại.",
    inviteTitle: "Mời Developer",
    emailLabel: "Email công việc",
    invite: "Gửi lời mời",
    membersTitle: "Developer đã cấp quyền",
    scopeLabel: "Phạm vi assessment",
    revoke: "Thu hồi quyền",
    empty: "Chưa có Developer nào được cấp quyền cho assessment này.",
  },
  wizard: {
    metadataTitle: "Wizard Assessment | LCSP",
    metadataDescription:
      "Khai báo bối cảnh nghiệp vụ của hệ thống AI theo từng bước có hướng dẫn.",
    pageTitle: "Wizard Assessment",
    pageDescription:
      "Mô tả cách hệ thống AI này được sử dụng trước khi bằng chứng kỹ thuật được xem xét.",
    loading: "Đang tải Wizard",
    loadingDetail: "Đang kiểm tra trạng thái assessment hiện tại.",
    preScreenBadge: "Phân luồng nhanh",
    detailedBadge: "Khai báo chi tiết",
    progressLabel: "Tiến độ",
    draftSaved: "Đã lưu bản nháp",
    draftSaving: "Đang lưu bản nháp",
    draftDirty: "Bản nháp còn thay đổi chưa lưu",
    helperButton: "Vì sao LCSP hỏi câu này?",
    helperClose: "Đóng phần trợ giúp",
    readOnlyBadge: "Chỉ xem",
    landingTitle: "Bắt đầu từ bối cảnh nghiệp vụ",
    landingDescription:
      "Bước này ghi nhận thông tin tự khai bằng ngôn ngữ nghiệp vụ. Đây chưa phải là kết luận pháp lý cuối cùng.",
    timeEstimate: "Thời gian ước tính: khoảng 10 phút",
    readinessOnlyHint:
      "Sau khi gửi, assessment sẽ vẫn ở trạng thái readiness-only cho tới khi có bằng chứng kỹ thuật.",
    preScreenTitle: "Phân luồng nhanh",
    preScreenDescription:
      "Các câu hỏi mở đầu giúp LCSP hiển thị đúng phần khai báo chi tiết tiếp theo.",
    readOnlyTitle: "Wizard này đã được gửi",
    readOnlyDescription:
      "Wizard đã gửi không thể chỉnh sửa trên trang này. Bạn có thể xem lại phần tóm tắt đã lưu trên trình duyệt này hoặc chuyển sang bước tiếp theo của assessment.",
    readOnlyEmpty:
      "Thiết bị này không có sẵn bản tóm tắt cục bộ. Wizard đã gửi vẫn đang ở chế độ khóa chỉnh sửa.",
    summaryTitle: "Tóm tắt bản nháp",
    summaryDescription:
      "Dùng phần này để kiểm tra lại thông tin đã được ghi nhận trong phiên trình duyệt hiện tại.",
    clearForm: "Xóa toàn bộ",
    helperTitle: "Giải thích thêm",
    helperDescription: "Ví dụ và giải thích ngắn gọn cho câu hỏi hiện tại.",
    actions: {
      backToWorkspace: "Quay lại workspace",
      previous: "Quay lại",
      saveAndContinue: "Lưu và tiếp tục",
      continueToDetailed: "Sang phần khai báo chi tiết",
      submit: "Gửi Wizard",
      openClassification: "Mở bước tiếp theo",
    },
    sections: {
      purpose: "Mục đích hệ thống",
      dataUsers: "Dữ liệu và người bị ảnh hưởng",
      decision: "Vai trò trong quyết định",
      provider: "Sử dụng AI bên ngoài",
      deployment: "Môi trường triển khai",
      risk: "Tín hiệu cần lưu ý thêm",
    },
    fields: {
      preAiScopeLabel:
        "Hệ thống này có dùng AI hoặc tạo gợi ý, nội dung bằng AI không?",
      preAiScopeDescription:
        "Chọn phương án gần nhất với vai trò của AI trong quy trình hiện tại.",
      preAffectedPeopleLabel:
        "Kết quả có thể ảnh hưởng tới khách hàng, nhân sự, ứng viên, học sinh, bệnh nhân hoặc người khác không?",
      preAffectedPeopleDescription:
        "Câu này giúp LCSP hiểu nhóm người có thể bị tác động trực tiếp.",
      prePersonalDataLabel:
        "Hệ thống có xử lý dữ liệu cá nhân, dữ liệu nhạy cảm hoặc dữ liệu sinh trắc học không?",
      prePersonalDataDescription:
        "Nếu chưa chắc, hãy chọn phương án giữ việc xem xét ở mức thận trọng.",
      preDecisionImportanceLabel:
        "Kết quả AI có thể ảnh hưởng tới một quyết định quan trọng về một người không?",
      preDecisionImportanceDescription:
        "Ví dụ: tuyển dụng, tiếp cận dịch vụ, đủ điều kiện, định giá hoặc kết quả phục vụ.",
      businessProcessLabel: "Hệ thống này đang hỗ trợ quy trình nghiệp vụ nào?",
      businessProcessDescription:
        "Mô tả quy trình nghiệp vụ chính bằng ngôn ngữ công việc hằng ngày.",
      businessProcessPlaceholder:
        "Ví dụ: Hỗ trợ nhóm chăm sóc khách hàng soạn phản hồi cho yêu cầu hỗ trợ.",
      aiPurposeLabel: "AI đóng vai trò gì trong quy trình này?",
      aiPurposeDescription:
        "Mô tả vai trò cụ thể của hệ thống AI trong quy trình được nêu ở trên.",
      aiPurposePlaceholder:
        "Ví dụ: Tóm tắt lịch sử hội thoại và đề xuất 3 câu trả lời dự kiến.",
      sectorLabel: "Bối cảnh nghiệp vụ nào phù hợp nhất với hệ thống này?",
      sectorDescription: "Chọn bối cảnh chính gần nhất cho assessment này.",
      dataTypeLabel: "Hệ thống dùng hoặc phân tích những loại dữ liệu nào?",
      dataTypeDescription:
        "Chọn tất cả nhóm dữ liệu có liên quan tới luồng AI này.",
      affectedSubjectsLabel: "Nhóm nào bị ảnh hưởng trực tiếp bởi kết quả?",
      affectedSubjectsDescription:
        "Chọn nhóm người bị tác động trực tiếp nhất bởi kết quả của hệ thống.",
      userImpactLabel: "Mức độ ảnh hưởng tới những người đó là bao nhiêu?",
      userImpactDescription:
        "Hãy nghĩ tới việc kết quả có thay đổi quyền truy cập, cơ hội, cách phục vụ hoặc cách đối xử hay không.",
      decisionRoleLabel:
        "Kết quả AI đóng vai trò gì trong quyết định cuối cùng?",
      decisionRoleDescription:
        "Chọn phương án phản ánh đúng nhất mức độ ảnh hưởng của kết quả tới đầu ra cuối cùng.",
      decisionRoleExamples:
        "Ví dụ: một gợi ý để nhân sự xem lại khác với một kết quả tự quyết định đầu ra.",
      humanReviewLabel:
        "Con người kiểm tra ở đâu trước khi kết quả có hiệu lực?",
      humanReviewDescription:
        "Câu hỏi này xuất hiện khi kết quả AI vượt quá vai trò hỗ trợ nền.",
      externalLlmUsageLabel:
        "Hệ thống có gọi dịch vụ AI bên ngoài như OpenAI, Anthropic, Google hoặc nhà cung cấp khác không?",
      externalLlmUsageDescription:
        "Chọn có nếu prompt hoặc nội dung rời khỏi môi trường của bạn để tới nhà cung cấp bên ngoài.",
      biometricIndicatorLabel:
        "Hệ thống có dùng dữ liệu sinh trắc học để nhận diện, xác minh hoặc chấm điểm không?",
      biometricIndicatorDescription:
        "Ví dụ: khuôn mặt, giọng nói, vân tay hoặc tín hiệu định danh tương tự.",
      highImpactIndicatorLabel:
        "Luồng này có liên quan tới tuyển dụng, giáo dục, tín dụng, y tế, dịch vụ công hoặc một bối cảnh quan trọng tương tự không?",
      highImpactIndicatorDescription:
        "Thông tin này giúp LCSP gắn cờ các luồng cần được theo dõi kỹ hơn ở bước sau.",
      deploymentContextLabel: "Ứng dụng này hướng tới ai sử dụng?",
      deploymentContextDescription:
        "Xác định xem ứng dụng được sử dụng nội bộ hay cung cấp ra ngoài cho người dùng khác.",
      specialCategoryDataLabel:
        "Dữ liệu có chứa các danh mục đặc biệt nhạy cảm không?",
      specialCategoryDataDescription:
        "Ví dụ: quan điểm chính trị, tôn giáo, thông tin công đoàn, v.v.",
      transparencyIndicatorsLabel:
        "Có tương tác trực tiếp hoặc tạo ra nội dung AI không?",
      transparencyIndicatorsDescription:
        "Cho biết người dùng có biết họ đang tương tác với AI hay nội dung do AI tạo ra không.",
      prohibitedRiskSignalsLabel:
        "Có dấu hiệu rủi ro không thể chấp nhận không?",
      prohibitedRiskSignalsDescription:
        "Các hệ thống đánh giá xã hội, thao túng tiềm thức hoặc suy diễn đặc điểm nhạy cảm bị cấm.",
    },
    options: {
      yes: "Có",
      no: "Không",
      unknown: "Tôi chưa rõ",
      sectorGeneral: "Vận hành kinh doanh chung",
      sectorHr: "Nhân sự hoặc tuyển dụng",
      sectorFinance: "Tài chính, tín dụng hoặc bảo hiểm",
      sectorEducation: "Giáo dục hoặc đào tạo",
      sectorHealthcare: "Y tế hoặc chăm sóc sức khỏe",
      sectorPublicServices: "Dịch vụ công hoặc quyền truy cập có điều kiện",
      dataTypePersonal: "Dữ liệu hồ sơ cá nhân",
      dataTypeSensitive: "Dữ liệu nhạy cảm hoặc đặc biệt",
      dataTypeBiometric: "Dữ liệu sinh trắc học",
      dataTypeBehavioral: "Dữ liệu hành vi hoặc sử dụng",
      dataTypeOperational: "Dữ liệu vận hành hoặc sản phẩm",
      userGroupCustomers: "Khách hàng hoặc người dùng cuối",
      userGroupEmployees: "Nhân viên hoặc nội bộ",
      userGroupApplicants: "Ứng viên",
      userGroupStudents: "Học sinh, sinh viên",
      userGroupPatients: "Bệnh nhân hoặc người được chăm sóc",
      userImpactLow: "Ảnh hưởng thấp",
      userImpactModerate: "Ảnh hưởng vừa",
      userImpactSignificant: "Ảnh hưởng đáng kể",
      decisionRoleNoAutonomousDecision:
        "Chỉ hỗ trợ công việc nền và không định hình quyết định cuối cùng",
      decisionRoleSupportsDecision:
        "Hỗ trợ một người đưa ra quyết định cuối cùng",
      decisionRoleInformsDecision:
        "Cung cấp thông tin cho người vẫn đưa ra quyết định cuối cùng",
      decisionRoleRecommendsOutcome:
        "Đề xuất một kết quả mà con người thường làm theo",
      decisionRoleDirectlyDrivesOutcome:
        "Gần như trực tiếp quyết định đầu ra với rất ít hoặc không có kiểm tra lại",
      humanOversightPresent:
        "Có người kiểm tra và có thể thay đổi kết quả trước khi áp dụng",
      humanOversightLimited:
        "Có người kiểm tra một số trường hợp nhưng không phải mọi kết quả",
      humanOversightAbsent:
        "Kết quả thường có hiệu lực mà không có bước kiểm tra thực chất",
      humanOversightNotApplicable:
        "Không áp dụng vì AI không ảnh hưởng tới quyết định cuối cùng",
      externalNone: "Không gọi dịch vụ ngoài",
      externalPossible: "Có khả năng gọi dịch vụ ngoài",
      externalConfirmed: "Xác nhận có dùng AI bên ngoài",
      deploymentInternal: "Sử dụng nội bộ",
      deploymentExternal: "Triển khai ra bên ngoài",
      highImpactRecruiting: "Tuyển dụng và nhân sự",
      highImpactCredit: "Tín dụng và tài chính",
      highImpactEducation: "Giáo dục",
      highImpactHealthcare: "Chăm sóc sức khỏe",
      transparencyDirectInteraction: "Tương tác trực tiếp (Chatbot, v.v.)",
      transparencyContentGeneration: "Tạo nội dung (Văn bản, Hình ảnh, v.v.)",
      prohibitedTracking: "Theo dõi không minh bạch",
      prohibitedManipulation: "Thao túng hành vi người dùng",
      prohibitedScoring: "Chấm điểm xã hội",
      prohibitedSensitiveInference: "Suy diễn các đặc điểm nhạy cảm",
    },
    helpers: {
      decisionTitle: "Cách trả lời câu hỏi về vai trò trong quyết định",
      decisionBody:
        "Hãy chọn mô tả mạnh nhất nhưng vẫn đúng với thực tế. Nếu kết quả AI có thể phê duyệt, từ chối, xếp hạng hoặc chặn một người với rất ít bước xem lại, hãy chọn mức ảnh hưởng cao hơn.",
      humanOversightTitle: "Khi nào được xem là có kiểm tra lại thực chất",
      humanOversightBody:
        "Một bước kiểm tra thực chất phải xảy ra trước khi kết quả có hiệu lực và người kiểm tra phải có quyền thật sự để chất vấn, thay đổi hoặc dừng kết quả đó.",
      providerTitle: "Khi nào cần tính là dùng nhà cung cấp bên ngoài",
      providerBody:
        "Chọn có khi nhóm của bạn gửi prompt, tài liệu hoặc nội dung người dùng tới một dịch vụ AI của bên thứ ba nằm ngoài môi trường bạn kiểm soát.",
    },
    errors: {
      loadTitle: "Không thể tải Wizard này",
      loadDetail: "Hiện chưa thể tải trạng thái assessment.",
      saveFailed: "Không thể lưu bản nháp. Vui lòng thử lại.",
      submitFailed:
        "Không thể gửi Wizard. Hãy kiểm tra lại các câu trả lời đang được đánh dấu rồi thử lại.",
      alreadySubmitted: "Wizard này đã được gửi và hiện ở chế độ chỉ xem.",
      preAiScopeRequired:
        "Vui lòng cho biết hệ thống này có dùng AI hay không trước khi tiếp tục.",
      preAffectedPeopleRequired:
        "Vui lòng chọn đối tượng có thể bị ảnh hưởng trước khi tiếp tục.",
      prePersonalDataRequired:
        "Vui lòng cho biết có xử lý dữ liệu cá nhân hay không trước khi tiếp tục.",
      preDecisionImportanceRequired:
        "Vui lòng cho biết kết quả AI có ảnh hưởng tới quyết định quan trọng không trước khi tiếp tục.",
      businessProcessRequired:
        "Hãy mô tả quy trình nghiệp vụ chính trước khi tiếp tục.",
      aiPurposeRequired:
        "Hãy mô tả mục đích của hệ thống AI trước khi tiếp tục.",
      sectorRequired: "Hãy chọn bối cảnh nghiệp vụ chính trước khi tiếp tục.",
      dataTypesRequired:
        "Hãy chọn ít nhất một nhóm dữ liệu trước khi tiếp tục.",
      affectedSubjectsRequired:
        "Hãy chọn nhóm bị ảnh hưởng trực tiếp trước khi tiếp tục.",
      userImpactRequired: "Hãy chọn mức độ ảnh hưởng trước khi tiếp tục.",
      decisionRoleRequired:
        "Hãy chọn mức độ ảnh hưởng của kết quả AI tới quyết định cuối cùng.",
      humanReviewRequired:
        "Hãy mô tả nơi con người kiểm tra kết quả trước khi tiếp tục.",
      externalLlmUsageRequired:
        "Hãy xác nhận hệ thống có dùng nhà cung cấp AI bên ngoài hay không trước khi tiếp tục.",
      deploymentContextRequired:
        "Hãy chọn đối tượng sử dụng ứng dụng trước khi tiếp tục.",
      specialCategoryDataRequired:
        "Hãy xác nhận có xử lý dữ liệu nhạy cảm đặc biệt hay không trước khi tiếp tục.",
      biometricDataRequired:
        "Hãy xác nhận có xử lý dữ liệu sinh trắc học hay không trước khi tiếp tục.",
      highImpactIndicatorsRequired:
        "Hãy chọn các nhóm rủi ro cao nếu có trước khi tiếp tục.",
      prohibitedRiskSignalsRequired:
        "Hãy chọn các nhóm rủi ro bị cấm nếu có trước khi tiếp tục.",
    },
  },
  readiness: {
    metadataTitle: "Trạng thái readiness | LCSP",
    metadataDescription: "Xem handoff readiness-only sau khi Wizard được gửi.",
    pageTitle: "Trạng thái readiness",
    pageDescription:
      "Màn hình này cho biết điều gì đã sẵn sàng, điều gì còn thiếu và bước an toàn tiếp theo trước khi phân loại có thể tiếp tục.",
    loading: "Đang tải trạng thái readiness",
    loadingDetail:
      "Đang kiểm tra trạng thái mới nhất của Wizard và bằng chứng kỹ thuật.",
    errorTitle: "Không thể tải trạng thái readiness",
    errorDetail: "Vui lòng thử lại sau ít phút.",
    badgeReadinessOnly: "Readiness only",
    badgeLocked: "Đang khóa",
    badgeReady: "Sẵn sàng cho cổng tiếp theo",
    summaryTitle: "Handoff hiện tại",
    summaryDescription:
      "Wizard đã hoàn tất, nhưng LCSP vẫn giữ assessment này ở trạng thái readiness-only cho tới khi có bằng chứng kỹ thuật.",
    summaryDescriptionReady:
      "Bằng chứng kỹ thuật cần thiết đã có và assessment có thể chuyển sang cổng kiểm soát tiếp theo.",
    exportErrorTitle: "Không thể tạo readiness export",
    exportErrorDetail:
      "Không thể tạo file PDF. Hãy kiểm tra Wizard đã được gửi và bằng chứng kỹ thuật vẫn chưa có.",
    completedTitle: "Các bước đã hoàn tất",
    missingTitle: "Những gì còn thiếu",
    nextActionTitle: "Bước tiếp theo",
    updatedAtLabel: "Cập nhật",
    noMissingEvidence: "Hiện không còn mục readiness nào bị thiếu.",
    noCompletedSteps: "Chưa có mốc readiness nào được xác nhận.",
    unresolvedTitle: "Bối cảnh nghiệp vụ chưa rõ",
    unresolvedDescription:
      "Những mục này cần được làm rõ thêm trước khi có thể phân loại.",
    noUnresolvedItems: "Không có mục nào chưa rõ.",
    unresolvedItemLabels: {
      affectedSubjects: "Chưa xác nhận đối tượng bị ảnh hưởng",
      dataTypes: "Chưa xác nhận loại dữ liệu",
      specialCategoryData: "Chưa rõ tình trạng dữ liệu đặc biệt",
      biometricData: "Chưa rõ việc sử dụng dữ liệu sinh trắc học",
      humanReview: "Chưa rõ quy trình kiểm tra của con người",
      externalLlmUsage: "Chưa rõ việc sử dụng AI bên ngoài",
      highImpactIndicators: "Chưa xác nhận bối cảnh ảnh hưởng cao",
      prohibitedRiskSignals: "Chưa đánh giá tín hiệu rủi ro bị cấm",
    },
    classificationLockedReason:
      "Cần có bằng chứng repository trước khi có thể thực hiện phân loại.",
    completedSteps: {
      wizardProfile: "Đã gửi Wizard profile",
      repositoryConnected: "Đã kết nối repository",
      technicalEvidenceAccepted: "Đã chấp nhận bằng chứng kỹ thuật",
    },
    missingEvidence: {
      repositoryConnection:
        "Kết nối repository đang được dùng cho hệ thống này.",
      technicalEvidence:
        "Chờ repository scan tạo ra bằng chứng kỹ thuật đã được chấp nhận.",
    },
    actions: {
      backToWorkspace: "Quay lại workspace",
      openClassification: "Mở trạng thái phân loại",
      openDocuments: "Mở tài liệu",
      connectRepository: "Kết nối Repository",
      editWizard: "Cập nhật Wizard",
      downloadPdf: "Tải Wizard Readiness PDF",
      exportingPdf: "Đang chuẩn bị PDF...",
    },
  },
  technicalEvidence: {
    pageTitle: "Bằng chứng kỹ thuật",
    pageDescription:
      "Theo dõi runtime của repository scan và trạng thái chấp nhận evidence cho assessment này.",
    connectionConnecting: "Đang kết nối runtime",
    connectionConnected: "Runtime đang kết nối",
    connectionDisconnected: "Runtime đang kết nối lại",
    scanJobsTitle: "Repository scans",
    evidenceReportsTitle: "Evidence reports",
    orchestrationTitle: "Log điều phối",
    awaitingEvent: "Đang chờ sự kiện runtime",
    lastUpdated: "Cập nhật lần cuối",
    noScanJobs: "Chưa có scan runtime nào cho assessment này.",
    noEvidenceReports: "Chưa có evidence report nào cho assessment này.",
    noOrchestrationActivity: "Chưa có hoạt động điều phối nào.",
    scanJobLabel: "Scan job",
    evidenceReportLabel: "Evidence report",
    updatedAt: "Cập nhật",
    createdAt: "Tạo lúc",
    attemptLabel: "Lần thử",
    inputSummaryLabel: "Đầu vào",
    outputSummaryLabel: "Đầu ra",
    errorSummaryLabel: "Lỗi",
    waitingReasonLabel: "Lý do chờ",
    rerunScan: "Chạy lại scan",
    rerunningScan: "Đang tạo scan mới",
    rerunError: "Không thể tạo scan mới. Hãy thử lại sau.",
    scanStatuses: {
      queued: "Đang chờ chạy",
      running: "Đang phân tích",
      completed: "Đã hoàn tất",
      failed: "Thất bại",
      blocked: "Bị chặn",
      pending: "Đang chờ xử lý",
    },
    evidenceStatuses: {
      accepted: "Đã chấp nhận",
      rejected: "Bị từ chối",
    },
    runtimeStatuses: {
      running: "Đang chạy",
      waiting: "Đang chờ",
      completed: "Đã hoàn tất",
      failed: "Thất bại",
    },
    runtimeStages: {
      snapshot: "Snapshot",
      scan: "Scan",
      technicalEvidence: "Bằng chứng kỹ thuật",
      technicalProfile: "Hồ sơ kỹ thuật",
      aiUsageFlow: "Luồng sử dụng AI",
      reconciliation: "Đối soát",
      classification: "Phân loại",
      conflicts: "Xung đột",
      documents: "Tài liệu",
      legalRetrieval: "Truy xuất pháp lý",
    },
    runtimeEvents: {
      runStarted: "Bắt đầu run",
      runStageChanged: "Đổi giai đoạn",
      toolStarted: "Bắt đầu tool",
      toolCompleted: "Hoàn tất tool",
      toolFailed: "Tool thất bại",
      toolWaitingInput: "Đang chờ đầu vào",
      toolSkipped: "Bỏ qua tool",
      runCompleted: "Run hoàn tất",
      runFailed: "Run thất bại",
    },
  },
  workspaceSelector: {
    metadataTitle: "Chọn workspace | LCSP",
    metadataDescription: "Chọn workspace tổ chức để tiếp tục.",
    eyebrow: "Tài khoản Developer",
    title: "Chọn workspace",
    description:
      "Tài khoản của bạn có thể được liên kết với nhiều workspace do từng Manager quản lý.",
    welcomeBackTitle: "Chào mừng bạn quay lại!",
    welcomeBackDescription: "Chọn một workspace hiện có để tiếp tục.",
    continueExistingWorkspaces: "HOẶC tiếp tục với workspace hiện có",
    readyToLaunch: "Sẵn sàng khởi chạy",
    missingSomething: "Thiếu workspace?",
    signInAnotherAccount: "Đăng nhập bằng tài khoản khác",
    members: "thành viên",
    lastSignIn: "Đăng nhập lần cuối",
    daysAgo: "ngày trước",
    dayAgo: "ngày trước",
    signedInAs: "Đang đăng nhập bằng",
    workspaceListLabel: "Workspace bạn có thể truy cập",
    loading: "Đang tải workspace",
    submit: "Tiếp tục",
    selected: "Đang chọn",
    openWorkspace: "Mở workspace",
    signOut: "Đăng xuất khỏi tài khoản này",
    noWorkspacesTitle: "Chưa có workspace",
    noWorkspacesDetail:
      "Tài khoản demo này chưa được liên kết với workspace nào.",
    errorTitle: "Không thể tải workspace",
    errorDetail: "Vui lòng đăng nhập lại hoặc thử lại sau.",
    privacyTerms: "Quyền riêng tư & Điều khoản",
    contactUs: "Liên hệ",
    changeRegion: "Đổi khu vực",
  },
  reconciliation: {
    metadataTitle: "Xử lý xung đột | LCSP",
    metadataDescription:
      "Xem các xung đột scan đang chờ và ghi nhận quyết định xử lý.",
    pageTitle: "Xử lý xung đột",
    pageDescription:
      "Giải quyết hoặc bác bỏ từng xung đột đang chờ. Bác bỏ bắt buộc phải có lý do.",
    loading: "Đang tải các xung đột đang chờ",
    pendingSectionLabel: "Các xung đột đang chờ",
    pendingBadge: "Đang chờ",
    scoreLabel: "Điểm xung đột",
    evidenceRefsLabel: "Tham chiếu evidence",
    resolutionLabel: "Kết quả xử lý",
    resolutionResolved: "Đã giải quyết",
    resolutionDismissed: "Bác bỏ",
    resolutionNoteLabel: "Ghi chú xử lý",
    resolutionNotePlaceholder:
      "Thêm ngữ cảnh cho quyết định này. Bắt buộc khi bác bỏ xung đột.",
    submitAction: "Gửi kết quả xử lý",
    submitting: "Đang gửi",
    allResolvedTitle: "Tất cả xung đột đã được xử lý",
    allResolvedDetail: "Hiện không còn xung đột đang chờ cho assessment này.",
    nextStepHint: "Bạn có thể tiếp tục quy trình assessment.",
    nextStepAction: "Quay lại danh sách assessment",
    accessRevokedTitle: "Không còn quyền truy cập",
    accessRevokedDetail:
      "Bạn không còn quyền xem hoặc xử lý xung đột cho assessment này.",
    errorTitle: "Không thể tải xung đột",
    errorDetail: "Vui lòng thử lại sau ít phút.",
    conflictTypeLabels: {
      evidenceContradiction: "Mâu thuẫn evidence",
      scopeMismatch: "Không khớp phạm vi",
      unverifiableFinding: "Phát hiện không thể xác minh",
      generic: "Xung đột",
    },
    errors: {
      dismissReasonRequired: "Hãy nhập lý do trước khi bác bỏ xung đột này.",
      alreadyResolved:
        "Xung đột này đã được xử lý trước đó. Danh sách đã được làm mới.",
      conflictNotFound:
        "Không còn tìm thấy xung đột này. Danh sách đã được làm mới.",
      resolveFailed: "Không thể hoàn tất yêu cầu xử lý. Vui lòng thử lại.",
    },
  },
  classification: {
    metadataTitle: "Trạng thái phân loại | LCSP",
    metadataDescription:
      "Xem trạng thái phân loại hiện tại cho assessment này.",
    pageTitle: "Trạng thái phân loại",
    pageDescription:
      "Theo dõi tiến trình phân loại hiện tại và bước tiếp theo cho assessment này.",
    loading: "Đang tải trạng thái phân loại",
    summaryLabel: "Tóm tắt",
    referencesLabel: "Tham chiếu pháp lý áp dụng",
    generateFinalReport: "Tạo Báo cáo Cuối cùng",
    generateGapAnalysis: "Tạo Phân tích Khoảng trống",
    rerunClassification: "Chạy lại phân loại",
    rerunSubmitting: "Đang đưa vào hàng đợi",
    errorTitle: "Không thể tải trạng thái phân loại",
    errorDetail: "Vui lòng thử lại sau ít phút.",
    verifiedProfileReview: {
      title: "Rà soát hồ sơ bằng chứng",
      description:
        "Kiểm tra các sự kiện assessment đã có bằng chứng trước khi đối chiếu pháp lý và phân loại.",
      verificationSourceLabel: "Nguồn xác minh",
      evidenceChainLabel: "Chuỗi bằng chứng",
      evidenceChainVerified: "Đã xác minh",
      evidenceChainNeedsReview: "Cần rà soát",
      providerVersionLabel: "Phiên bản provider",
      verificationSources: {
        TECHNICAL_PLUS_WIZARD: "Bằng chứng kỹ thuật và câu trả lời wizard",
        UNKNOWN: "Chưa có dữ liệu",
      },
      factsTitle: "Sự kiện assessment",
      noClaims: "Chưa có sự kiện assessment nào được ghi nhận.",
      unknownClaimTitle: "Sự kiện assessment",
      claimIdLabel: "Mã tham chiếu",
      claimTypeLabel: "Nhóm sự kiện",
      claimFieldLabel: "Trường assessment",
      confidenceLabel: "Độ tin cậy",
      lifecycleStateLabel: "Trạng thái",
      materialityLabel: "Có trọng yếu",
      evidenceSummaryLabel: "Bằng chứng",
      evidenceItemLabel: "nguồn bằng chứng được gắn",
      evidenceItemsLabel: "nguồn bằng chứng được gắn",
      notProvided: "Chưa có dữ liệu",
      yes: "Có",
      no: "Không",
      conflictSummary:
        "quyết định đối soát đang được gắn với hồ sơ này.",
      approvalFailedTitle: "Phê duyệt thất bại",
      approvalFailedDetail:
        "Hồ sơ chưa được phê duyệt. Hãy tải lại assessment và kiểm tra hồ sơ vẫn đang chờ phê duyệt.",
      approveButton: "Phê duyệt hồ sơ bằng chứng",
      approvingButton: "Đang phê duyệt",
      approvedMessage:
        "Đã phê duyệt. Đối chiếu pháp lý có thể tự động tiếp tục.",
      statuses: {
        PENDING_APPROVAL: "Chờ phê duyệt",
        APPROVED: "Đã phê duyệt",
        REJECTED: "Đã từ chối",
        UNKNOWN: "Cần rà soát",
      },
      claimTitles: {
        MODEL_PROVIDER_USAGE: "Sử dụng nhà cung cấp AI",
        MODEL_INVOCATION: "Gọi mô hình AI",
        PERSONAL_DATA_INPUT: "Dữ liệu cá nhân đưa vào AI",
        HUMAN_REVIEW: "Có rà soát bởi con người",
        AFFECTED_SUBJECTS: "Đối tượng bị ảnh hưởng",
        BUSINESS_PROCESS: "Quy trình nghiệp vụ",
        AI_PURPOSE: "Mục đích sử dụng AI",
        UNKNOWN: "Sự kiện assessment",
      },
      claimDescriptions: {
        model_provider_usage:
          "Hệ thống có dấu hiệu dùng nhà cung cấp AI bên ngoài hoặc nội bộ.",
        model_invocation:
          "Repository có đường code gọi hoặc vận hành mô hình AI.",
        personal_data_input:
          "Có dấu hiệu dữ liệu cá nhân được đưa vào luồng xử lý AI.",
        human_review:
          "Quy trình có hoặc cần bước rà soát bởi con người.",
        affected_subjects:
          "Những cá nhân hoặc nhóm chịu tác động bởi quy trình có AI.",
        business_process:
          "Quy trình nghiệp vụ nơi AI được sử dụng để hỗ trợ xử lý.",
        ai_purpose: "Mục đích của chức năng hoặc quy trình có dùng AI.",
      },
      confidenceLevels: {
        low: "Thấp",
        medium: "Trung bình",
        high: "Cao",
        unknown: "Không rõ",
      },
      lifecycleStates: {
        DETECTED: "Đã phát hiện",
        ABSTAINED: "Chưa kết luận",
        INFERRED: "Suy luận từ bằng chứng",
        CONFIRMED: "Đã xác nhận",
        UNKNOWN: "Không rõ",
      },
    },
    states: {
      lockedTitle: "Phân loại đã bị khóa",
      lockedBadge: "Đã khóa",
      lockedDescription:
        "Vẫn cần bằng chứng kỹ thuật trước khi phân loại có thể tiếp tục.",
      lockedNextSteps:
        "Cung cấp thêm bằng chứng kỹ thuật bị thiếu để quá trình phân loại tiếp tục và bước tiếp theo có thể được chuẩn bị.",
      processingTitle: "Đang phân loại",
      processingBadge: "Đang xử lý",
      processingDescription: "Quá trình phân loại vẫn đang được chuẩn bị.",
      passedTitle: "Phân loại đã sẵn sàng",
      passedBadge: "Sẵn sàng",
      passedDescription:
        "Các tham chiếu pháp lý có sẵn đã được xác minh và phân loại có thể tiếp tục.",
      passedSummary:
        "Các tham chiếu pháp lý phù hợp đã sẵn sàng cho bước tiếp theo.",
      degradedTitle: "Phân loại cần xem xét",
      degradedBadge: "Cần xem xét",
      degradedDescription:
        "Một số tham chiếu pháp lý chưa thể xác minh đầy đủ.",
      degradedSummary:
        "Phân loại đã có sẵn, nhưng một số tham chiếu cần được xem xét thêm.",
      blockedTitle: "Không thể hoàn tất phân loại",
      blockedBadge: "Bị chặn",
      blockedDescription:
        "Phân loại không thể hoàn tất vì thiếu căn cứ trích dẫn.",
      blockedSummary:
        "Cần có căn cứ trích dẫn hợp lệ trước khi bước tiếp theo có thể tiến hành.",
    },
    finalReportRequestedTitle: "Yêu cầu báo cáo cuối cùng đã được gửi",
    finalReportRequestedDetail:
      "Yêu cầu báo cáo cuối cùng đã được xếp vào hàng. Bạn có thể quay lại sau khi quá trình xử lý hoàn tất để tải về.",
    documentsPageDescription:
      "Yêu cầu báo cáo cuối cùng và xem trạng thái đầu ra cho assessment này.",
    finalReportPageHint:
      "Yêu cầu báo cáo cuối cùng được bảo hộ. Chỉ khả dụng khi guardrail phân loại đã được vượt qua.",
    requestFinalReportButton: "Yêu cầu Báo cáo Cuối cùng",
    gapAnalysisLabel: "Phân tích khoảng trống",
    gapAnalysisPendingMessage:
      "Phân tích khoảng trống sẽ được tạo bởi bước worker tiếp theo sau phân loại. Nó sẽ khả dụng khi đường ống tài liệu sẵn sàng.",
    documentGuardrailBlocked:
      "Không thể tạo báo cáo cuối cùng vì guardrail phân loại chưa được vượt qua.",
    documentList: {
      title: "Tài liệu assessment",
      description: "Theo dõi trạng thái tạo các tài liệu assessment có sẵn.",
    },
    documentMeta: {
      requestedAt: "Yêu cầu lúc",
    },
    documentTypes: {
      finalReport: "Báo cáo cuối cùng",
      gapAnalysis: "Phân tích khoảng trống",
      readinessExport: "Xuất sẵn sàng",
      unknown: "Tài liệu",
    },
    documentStates: {
      queued: "Đang chuẩn bị",
      generating: "Đang tạo",
      ready: "Sẵn sàng",
      failed: "Tạo thất bại",
      blocked: "Bị chặn",
      unknown: "Đang chờ",
      failedDetail: "Tạo tài liệu thất bại. Vui lòng thử lại.",
      permissionDenied: "Quyền tải về bị hạn chế cho phạm vi hiện tại của bạn.",
    },
    documentActions: {
      download: "Tải về",
    },
  },
  legalLibrary: {
    metadataTitle: "Văn bản pháp luật | LCSP",
    metadataDescription:
      "Tra cứu các văn bản pháp luật Việt Nam được dùng làm căn cứ trong LCSP.",
    pageTitle: "Văn bản pháp luật",
    pageDescription:
      "Đọc bản lưu trong LCSP và đối chiếu với nguồn công bố chính thức của Chính phủ.",
    officialSourceLabel: "Nguồn chính thức",
    readDocument: "Đọc văn bản",
    openOfficialSource: "Mở nguồn Chính phủ",
    downloadDocument: "Tải PDF",
    documentReferenceLabel: "Số hiệu",
    issuedOnLabel: "Ngày ban hành",
    effectiveOnLabel: "Ngày có hiệu lực",
    authorityLabel: "Cơ quan ban hành",
    documentUnavailableTitle: "Không tìm thấy văn bản",
    documentUnavailableDescription:
      "Văn bản được yêu cầu không có trong thư viện pháp luật của workspace.",
    riskTableTitle: "Legal risk đã xử lý",
    riskTableDescription:
      "Các chunk theo phạm vi trang của văn bản gốc, được ưu tiên để rà soát trong quy trình LCSP.",
    riskTableDisclaimer:
      "Mức độ rủi ro là thứ tự ưu tiên rà soát của LCSP, không phải kết luận pháp lý.",
    chunkIdLabel: "Chunk",
    documentLabel: "Văn bản",
    locatorLabel: "Phạm vi nguồn",
    riskLevelLabel: "Mức độ rủi ro",
    riskLevels: {
      LOW: "Thấp",
      MEDIUM: "Trung bình",
      HIGH: "Cao",
    },
    documents: {
      aiLaw: {
        title: "Luật Trí tuệ nhân tạo",
        reference: "134/2025/QH15",
        issuedOn: "10/12/2025",
        effectiveOn: "01/03/2026",
        authority: "Quốc hội",
      },
      digitalTechnologyIndustryLaw: {
        title: "Luật Công nghiệp công nghệ số",
        reference: "71/2025/QH15",
        issuedOn: "14/06/2025",
        effectiveOn: "01/01/2026",
        authority: "Quốc hội",
      },
    },
  },
} as const satisfies PagesMessages;
