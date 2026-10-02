export const ASSESSMENT_FIELD_LIMITS = {
  nameMaxLength: 200,
  descriptionMaxLength: 1000,
} as const;

export const ASSESSMENT_NAME_MAX_LENGTH = ASSESSMENT_FIELD_LIMITS.nameMaxLength;
export const ASSESSMENT_DESCRIPTION_MAX_LENGTH = ASSESSMENT_FIELD_LIMITS.descriptionMaxLength;

/** Single authority for the Interview guidance content version pinned on new Interview threads. */
export const INTERVIEW_GUIDANCE_VERSION = "interview-guidance-dev-v1";
