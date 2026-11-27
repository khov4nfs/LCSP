import {
  SIGN_UP_FIELD_AUTOCOMPLETE,
  SIGN_UP_FIELD_TYPES,
  type SignUpFieldDefinition,
} from "../types/sign-up.types";

export const signUpFields: readonly SignUpFieldDefinition[] = [
  {
    name: "display_name",
    labelKey: "pages.signUp.displayNameLabel",
    // The visible placeholder mirrors the audited Figma field while description copy stays available to assistive technology.
    placeholderKey: "pages.signUp.displayNamePlaceholder",
    type: SIGN_UP_FIELD_TYPES.text,
    autoComplete: SIGN_UP_FIELD_AUTOCOMPLETE.name,
    descriptionKey: "pages.signUp.displayNameDescription",
  },
  {
    name: "email",
    labelKey: "pages.signUp.emailLabel",
    placeholderKey: "pages.signUp.emailPlaceholder",
    type: SIGN_UP_FIELD_TYPES.email,
    autoComplete: SIGN_UP_FIELD_AUTOCOMPLETE.email,
    descriptionKey: "pages.signUp.emailDescription",
  },
  {
    name: "password",
    labelKey: "pages.signUp.passwordLabel",
    placeholderKey: "pages.signUp.passwordPlaceholder",
    type: SIGN_UP_FIELD_TYPES.password,
    autoComplete: SIGN_UP_FIELD_AUTOCOMPLETE.newPassword,
    descriptionKey: "pages.signUp.passwordDescription",
  },
  {
    name: "confirm_password",
    labelKey: "pages.signUp.confirmPasswordLabel",
    placeholderKey: "pages.signUp.confirmPasswordPlaceholder",
    type: SIGN_UP_FIELD_TYPES.password,
    autoComplete: SIGN_UP_FIELD_AUTOCOMPLETE.newPassword,
    descriptionKey: "pages.signUp.confirmPasswordDescription",
  },
];
