import type { MessageKey } from "@lcsp/i18n";
import type { SignUpFormValues } from "../schemas/sign-up.schema";

export const SIGN_UP_FIELD_TYPES = {
  email: "email",
  password: "password",
  text: "text",
} as const;

export const SIGN_UP_FIELD_AUTOCOMPLETE = {
  email: "email",
  name: "name",
  newPassword: "new-password",
  organization: "organization",
} as const;

export const SIGN_UP_SUBMISSION_ERRORS = {
  emailAlreadyExists: "email_already_exists",
  invalidRequest: "invalid_request",
  requestFailed: "request_failed",
} as const;

export type SignUpFieldName = keyof SignUpFormValues;
export type SignUpFieldType =
  (typeof SIGN_UP_FIELD_TYPES)[keyof typeof SIGN_UP_FIELD_TYPES];
export type SignUpFieldAutocomplete =
  (typeof SIGN_UP_FIELD_AUTOCOMPLETE)[keyof typeof SIGN_UP_FIELD_AUTOCOMPLETE];
export type SignUpSubmissionError =
  | (typeof SIGN_UP_SUBMISSION_ERRORS)[keyof typeof SIGN_UP_SUBMISSION_ERRORS]
  | null;

export type SignUpFieldDefinition = {
  name: SignUpFieldName;
  labelKey: MessageKey;
  type: SignUpFieldType;
  autoComplete: SignUpFieldAutocomplete;
  descriptionKey: MessageKey;
};

export type SignUpFieldProps = {
  field: SignUpFieldDefinition;
};
