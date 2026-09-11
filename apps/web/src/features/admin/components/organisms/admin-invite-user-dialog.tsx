"use client";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { resolveAppMessage as t } from "@/lib/i18n";
import { useAdminInviteUserMutation } from "@/lib/api/admin-users-queries";
import {
  adminInviteUserSchema,
  type AdminInviteUserValues,
} from "../../schemas/admin-invite-user.schema";
import { accountMutationErrorKey } from "../../config/account-mutation-error";

export function AdminInviteUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useAdminInviteUserMutation();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [sent, setSent] = useState(false);
  const form = useForm<AdminInviteUserValues>({
    resolver: zodResolver(adminInviteUserSchema),
    defaultValues: {
      displayName: "",
      email: "",
      role: AUTH_USER_ROLES.customer,
    },
  });
  async function submit(values: AdminInviteUserValues) {
    const input = { ...values, email: values.email.toLowerCase() };
    const fingerprint = JSON.stringify(input);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await mutation.mutateAsync({
        ...input,
        idempotencyKey: retry.current.key,
      });
      setSent(true);
      retry.current = null;
      form.reset();
    } catch {
      /* mutation state provides the safe localized error */
    }
  }
  function close() {
    if (!mutation.isPending) {
      setSent(false);
      mutation.reset();
      onClose();
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.accountLifecycle.inviteTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages.accountLifecycle.inviteDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            // Construct the submit handler only when the event occurs. The
            // retry ref is event-owned state, never an input to rendering.
            void form.handleSubmit(submit)(event);
          }}
          noValidate
        >
          <DialogBody className="space-y-4">
            {sent ? (
              <p role="status">{t("pages.accountLifecycle.inviteSuccess")}</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="invite-name">
                    {t("pages.accountLifecycle.displayName")}
                  </Label>
                  <Input
                    id="invite-name"
                    autoComplete="name"
                    disabled={mutation.isPending}
                    aria-invalid={Boolean(form.formState.errors.displayName)}
                    {...form.register("displayName")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-email">
                    {t("pages.accountLifecycle.email")}
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    autoComplete="email"
                    disabled={mutation.isPending}
                    aria-invalid={Boolean(form.formState.errors.email)}
                    {...form.register("email")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">
                    {t("pages.accountLifecycle.role")}
                  </Label>
                  <select
                    id="invite-role"
                    className="h-10 w-full rounded-md border border-input bg-background px-3"
                    disabled={mutation.isPending}
                    {...form.register("role")}
                  >
                    <option value={AUTH_USER_ROLES.customer}>
                      {t("pages.admin.usersList.roles.CUSTOMER")}
                    </option>
                    <option value={AUTH_USER_ROLES.admin}>
                      {t("pages.admin.usersList.roles.ADMIN")}
                    </option>
                  </select>
                </div>
                {Object.keys(form.formState.errors).length > 0 && (
                  <p role="alert" className="text-destructive">
                    {t("pages.accountLifecycle.required")}
                  </p>
                )}
                {mutation.error && (
                  <p role="alert" className="text-destructive">
                    {t(accountMutationErrorKey(mutation.error))}
                  </p>
                )}
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={close}
            >
              {t("pages.accountLifecycle.cancel")}
            </Button>
            {!sent && (
              <Button type="submit" disabled={mutation.isPending}>
                {t(
                  mutation.isPending
                    ? "pages.accountLifecycle.sending"
                    : "pages.accountLifecycle.sendInvite",
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
