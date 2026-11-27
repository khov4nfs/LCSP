import {
  CREDENTIAL_FIELD_AUTOCOMPLETE,
  CREDENTIAL_FIELD_TYPES,
  type CredentialFieldDefinition,
} from "../types/sign-in.types";

export const signInFields: readonly CredentialFieldDefinition[] = [
  {
    name: "email",
    labelKey: "pages.signIn.emailLabel",
    // Keep the visible placeholder distinct from the screen-reader helper description.
    placeholderKey: "pages.signIn.emailPlaceholder",
    type: CREDENTIAL_FIELD_TYPES.email,
    autoComplete: CREDENTIAL_FIELD_AUTOCOMPLETE.email,
    descriptionKey: "pages.signIn.emailDescription",
  },
  {
    name: "password",
    labelKey: "pages.signIn.passwordLabel",
    placeholderKey: "pages.signIn.passwordPlaceholder",
    type: CREDENTIAL_FIELD_TYPES.password,
    autoComplete: CREDENTIAL_FIELD_AUTOCOMPLETE.currentPassword,
    descriptionKey: "pages.signIn.passwordDescription",
  },
];
