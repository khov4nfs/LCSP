import type { SignInFormValues } from "../schemas/sign-in.schema";
import type { MessageKey } from "@lcsp/i18n";

export const CREDENTIAL_FIELD_TYPES = {
  email: "email",
  password: "password",
} as const;

export const CREDENTIAL_FIELD_AUTOCOMPLETE = {
  email: "email",
  currentPassword: "current-password",
} as const;

type CredentialFieldName = keyof SignInFormValues;
type CredentialFieldType =
  (typeof CREDENTIAL_FIELD_TYPES)[keyof typeof CREDENTIAL_FIELD_TYPES];
type CredentialFieldAutocomplete =
  (typeof CREDENTIAL_FIELD_AUTOCOMPLETE)[keyof typeof CREDENTIAL_FIELD_AUTOCOMPLETE];

export type CredentialFieldDefinition = {
  name: CredentialFieldName;
  labelKey: MessageKey;
  type: CredentialFieldType;
  autoComplete: CredentialFieldAutocomplete;
  descriptionKey: MessageKey;
};

export type CredentialFieldProps = {
  field: CredentialFieldDefinition;
};
