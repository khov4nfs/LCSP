"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import { Controller, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useConfigureProviderCredentialMutation } from "@/lib/api/github-repository-queries";
import { githubRepositoryProblemMessageKey } from "@/lib/api/github-repository-client";
import { appLocale } from "@/lib/locale";

import {
  githubRepositoryCredentialSchema,
  type GitHubRepositoryCredentialValues,
} from "../../schemas/github-repository-connect.schema";

type GitHubRepositoryConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
};

export function GitHubRepositoryConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: GitHubRepositoryConnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <GitHubRepositoryConnectDialogContent
          onOpenChange={onOpenChange}
          onConnected={onConnected}
        />
      ) : null}
    </Dialog>
  );
}

function GitHubRepositoryConnectDialogContent({
  onOpenChange,
  onConnected,
}: Omit<GitHubRepositoryConnectDialogProps, "open">) {
  const connectMutation = useConfigureProviderCredentialMutation();
  const form = useForm<GitHubRepositoryCredentialValues>({
    resolver: zodResolver(githubRepositoryCredentialSchema),
    defaultValues: {
      provider: CREDENTIAL_PROVIDERS.github,
      credential: "",
    },
  });
  const failed = connectMutation.isError;
  const requestError = connectMutation.error;
  async function submit(values: GitHubRepositoryCredentialValues) {
    try {
      await connectMutation.mutateAsync({
        credential: values.credential,
        provider: values.provider,
      });
      form.reset({ credential: "" });
      onConnected();
      onOpenChange(false);
    } catch {
      // React Query exposes the sanitized failure through mutation state;
      // keep the rejection inside the form handler so it is not reported as
      // an unhandled browser/Next.js rejection.
    } finally {
      form.reset({
        provider: CREDENTIAL_PROVIDERS.github,
        credential: "",
      });
    }
  }

  return (
    <DialogContent
      closeLabel={resolveMessage(
        appLocale,
        "pages.workspace.settingsHub.repositories.dialogClose",
      )}
    >
      <DialogHeader>
        <DialogTitle>
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.dialogTitle",
          )}
        </DialogTitle>
        <DialogDescription>
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.connectDescription",
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="github-provider">
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.providerLabel",
                )}
              </FieldLabel>
              <Controller
                control={form.control}
                name="provider"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="github-provider" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CREDENTIAL_PROVIDERS.github}>
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.repositories.githubProvider",
                        )}
                      </SelectItem>
                      <SelectItem value={CREDENTIAL_PROVIDERS.gitlab}>
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.repositories.gitlabProvider",
                        )}
                      </SelectItem>
                      <SelectItem value={CREDENTIAL_PROVIDERS.bitbucket}>
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.repositories.bitbucketProvider",
                        )}
                      </SelectItem>
                      <SelectItem value={CREDENTIAL_PROVIDERS.azureDevOps}>
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.repositories.azureDevOpsProvider",
                        )}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field
              data-invalid={
                Boolean(form.formState.errors.credential) || undefined
              }
            >
              <FieldLabel htmlFor="github-manager-credential">
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.credentialLabel",
                )}
              </FieldLabel>
              <Input
                id="github-manager-credential"
                type="password"
                autoComplete="off"
                spellCheck={false}
                {...form.register("credential")}
              />
              {form.formState.errors.credential?.message ? (
                <FieldError>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.repositories.credentialRequired",
                  )}
                </FieldError>
              ) : null}
            </Field>
            {failed ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.repositories.requestFailedTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    appLocale,
                    githubRepositoryProblemMessageKey(requestError),
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.connectAction",
              )}
            </Button>
          </FieldGroup>
        </form>
      </DialogBody>
    </DialogContent>
  );
}
