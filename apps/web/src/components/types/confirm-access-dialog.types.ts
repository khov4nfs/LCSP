import type { MessageKey } from "@lcsp/i18n";
import type {
  ConfirmAccessOtpValues,
  ConfirmAccessPasswordValues,
} from "@/components/schemas/confirm-access-dialog.schema";

export const CONFIRM_ACCESS_METHODS = {
  password: "password",
  otp: "otp",
} as const;

export type ConfirmAccessMethod =
  (typeof CONFIRM_ACCESS_METHODS)[keyof typeof CONFIRM_ACCESS_METHODS];

export const CONFIRM_ACCESS_SUPPORT_ITEM_KINDS = {
  action: "action",
  link: "link",
} as const;

type ConfirmAccessSupportActionItem = {
  kind: typeof CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.action;
  labelKey: MessageKey;
  onSelect: () => void;
};

type ConfirmAccessSupportLinkItem = {
  kind: typeof CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.link;
  labelKey: MessageKey;
  href: string;
};

export type ConfirmAccessSupportItem =
  | ConfirmAccessSupportActionItem
  | ConfirmAccessSupportLinkItem;

export type SignedInAccountPanelProps = {
  accountLabelKey: MessageKey;
  accountHandle: string;
  avatarImageSrc?: string;
  avatarFallback: string;
};

export type ConfirmAccessSupportLinksProps = {
  titleKey: MessageKey;
  items: ConfirmAccessSupportItem[];
};

type ConfirmAccessDialogMfaOptions = {
  isEnabled: boolean;
  isConfigured: boolean;
  onSubmit: (values: ConfirmAccessOtpValues) => Promise<void> | void;
  otpLabelKey: MessageKey;
  otpDescriptionKey?: MessageKey;
  otpPlaceholderKey?: MessageKey;
  verifyLabelKey: MessageKey;
  verifyingLabelKey: MessageKey;
  switchToMfaLabelKey: MessageKey;
  switchToPasswordLabelKey: MessageKey;
  githubMobileHref?: string;
  githubMobileLabelKey?: MessageKey;
  setupHref?: string;
  onSetupRequest?: () => void;
  errorTitleKey?: MessageKey;
  errorKey?: MessageKey | null;
};

export type ConfirmAccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordSubmit: (
    values: ConfirmAccessPasswordValues,
  ) => Promise<void> | void;
  accountLabelKey: MessageKey;
  accountHandle: string;
  avatarFallback: string;
  avatarImageSrc?: string;
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  passwordLabelKey: MessageKey;
  passwordDescriptionKey?: MessageKey;
  passwordPlaceholderKey?: MessageKey;
  forgotPasswordHref?: string;
  forgotPasswordLabelKey?: MessageKey;
  supportTitleKey?: MessageKey;
  confirmLabelKey: MessageKey;
  confirmingLabelKey: MessageKey;
  closeLabelKey: MessageKey;
  errorTitleKey?: MessageKey;
  errorKey?: MessageKey | null;
  mfa?: ConfirmAccessDialogMfaOptions;
};
