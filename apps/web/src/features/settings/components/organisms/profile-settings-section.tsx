"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useEffect, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { FormTextField } from "@/components/molecules/form-text-field";
import { Button } from "@/components/ui/button";
import {
  useAuthSettingsProfileQuery,
  useUpdateProfileMutation,
} from "@/lib/api/auth-queries";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { appLocale } from "@/lib/locale";
import { useHydrated } from "@/components/hooks/use-hydrated";
import {
  profileSettingsSchema,
  type ProfileSettingsValues,
} from "../../schemas/profile-settings.schema";
import type {
  ProfileSettingsEditorProps,
  ProfileSettingsSectionProps,
} from "../../types/profile-settings.types";

export function ProfileSettingsSection(props: ProfileSettingsSectionProps) {
  const hydrated = useHydrated();
  const query = useAuthSettingsProfileQuery();
  const profile = hydrated ? query.data : undefined;
  const t = (key: MessageKey) => resolveMessage(appLocale, key);
  return (
    <section aria-labelledby="settings-profile-heading" className="space-y-4">
      <h2 id="settings-profile-heading" className="text-lg font-semibold">
        {t("pages.workspace.settingsHub.general.profileTitle")}
      </h2>
      {!hydrated || query.isPending ? (
        <p role="status">{t("pages.workspace.settingsHub.profile.loading")}</p>
      ) : null}
      {hydrated && query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("pages.workspace.settingsHub.errors.profileLoadDetail")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("pages.workspace.settingsHub.profile.retry")}
          </Button>
        </div>
      ) : null}
      {profile?.display_name === null ? (
        <p className="text-sm text-muted-foreground">
          {t("pages.workspace.settingsHub.profile.emptyName")}
        </p>
      ) : null}
      {profile ? <ProfileSettingsEditor profile={profile} {...props} /> : null}
    </section>
  );
}

function ProfileSettingsEditor({
  profile,
  onReauthenticate,
}: ProfileSettingsEditorProps) {
  const mutation = useUpdateProfileMutation();
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const form = useForm<ProfileSettingsValues>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: { display_name: profile.display_name ?? "" },
  });
  const {
    reset,
    formState: { isDirty, isSubmitting },
  } = form;
  const currentName = useWatch({ control: form.control, name: "display_name" });

  useEffect(() => {
    if (!isDirty && !isSubmitting)
      reset({ display_name: profile.display_name ?? "" });
  }, [profile.display_name, isDirty, isSubmitting, reset]);

  /**
   * Business purpose: Save a user's display name without losing a rejected or unconfirmed draft.
   * Business rules:
   * - Submit only validated names; authentication challenges require explicit completion before one retry.
   * - Show success only after persistence and confirmation; cancellation never retries the patch.
   * Execution flow:
   * 1. Clear previous feedback and submit the validated name.
   * 2. If challenged, wait for the existing reauthentication flow and retry once after confirmation.
   * 3. Reset the draft on confirmed success, or attach field/form errors while retaining input.
   * Failure cases:
   * - Invalid names, expired sessions, canceled challenges and transport/confirmation failures never report success.
   * Side effects:
   * - Updates profile through the shared mutation; may open reauthentication and reset confirmed form values.
   */
  async function saveProfile(values: ProfileSettingsValues) {
    setErrorKey(null);
    setSavedName(null);
    try {
      let outcome = await mutation.mutateAsync(values);
      if (
        outcome.kind === API_OUTCOME_KINDS.mfaRequired ||
        outcome.kind === API_OUTCOME_KINDS.reauthRequired
      ) {
        if (
          !(await onReauthenticate(
            outcome.kind === API_OUTCOME_KINDS.mfaRequired,
          ))
        ) {
          setErrorKey("pages.workspace.settingsHub.profile.reauthCancelled");
          return;
        }
        outcome = await mutation.mutateAsync(values);
      }
      if (outcome.kind === API_OUTCOME_KINDS.saved) {
        reset(values);
        setSavedName(values.display_name);
      } else if (outcome.kind === API_OUTCOME_KINDS.validationError) {
        form.setError(
          "display_name",
          { message: "pages.workspace.settingsHub.profile.nameRejected" },
          { shouldFocus: true },
        );
      } else {
        setErrorKey(
          outcome.kind === API_OUTCOME_KINDS.sessionInvalid
            ? "auth.errors.sessionInvalid.detail"
            : "pages.workspace.settingsHub.profile.saveFailed",
        );
      }
    } catch {
      setErrorKey("pages.workspace.settingsHub.profile.saveFailed");
    }
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(saveProfile)}
        noValidate
        className="space-y-4"
        aria-busy={isSubmitting}
      >
        {/* Keep this profile draft usable at narrow widths without changing shared-field defaults. */}
        <FormTextField<ProfileSettingsValues>
          name="display_name"
          id="settings-full-name"
          autoComplete="name"
          inputClassName="max-w-64"
          wrapActions
          labelKey="pages.workspace.settingsHub.labels.displayName"
          descriptionKey="pages.workspace.settingsHub.profile.nameHelp"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!isDirty || isSubmitting}
                onClick={() => {
                  reset({ display_name: profile.display_name ?? "" });
                  setErrorKey(null);
                  setSavedName(null);
                }}
              >
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.actions.cancel",
                )}
              </Button>
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {resolveMessage(
                  appLocale,
                  isSubmitting
                    ? "pages.workspace.settingsHub.profile.saving"
                    : "pages.workspace.settingsHub.profile.save",
                )}
              </Button>
            </>
          }
        />
        {errorKey ? (
          <p role="alert" className="text-sm text-destructive">
            {resolveMessage(appLocale, errorKey)}
          </p>
        ) : null}
        <p role="status" className="text-sm text-muted-foreground">
          {savedName !== null && currentName === savedName
            ? resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.profile.saved",
              )
            : null}
        </p>
      </form>
    </FormProvider>
  );
}
