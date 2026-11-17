import { z } from "zod";

export const profileSettingsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "pages.workspace.settingsHub.profile.nameRequired")
    .max(120, "pages.workspace.settingsHub.profile.nameTooLong"),
});

export type ProfileSettingsValues = z.infer<typeof profileSettingsSchema>;
