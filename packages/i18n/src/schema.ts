import { enAuth } from "./locales/en/auth.ts";
import { enAssessment } from "./locales/en/assessment.ts";
import { enCommon } from "./locales/en/common.ts";
import { enPages } from "./locales/en/pages.ts";

export const defaultMessages = {
  assessment: enAssessment,
  auth: enAuth,
  common: enCommon,
  pages: enPages,
} as const;
