import { AlertTriangleIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";

type AdminSuspendConfirmationContentProps = {
  userName: string;
  userEmail: string;
};

export function AdminSuspendConfirmationContent({
  userName,
  userEmail,
}: AdminSuspendConfirmationContentProps) {
  const warningText = resolveAppMessage(
    "pages.admin.userDetail.suspendModal.warning" as MessageKey,
  );
  const descriptionTemplate = resolveAppMessage(
    "pages.admin.userDetail.suspendModal.description" as MessageKey,
  );

  const formattedDescription = descriptionTemplate
    .replace("{name}", userName)
    .replace("{email}", userEmail);

  return (
    <div className="flex flex-col space-y-4">
      {/* Warning Notice Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-admin-danger-border bg-admin-danger-surface p-3.5 text-admin-danger-foreground">
        <AlertTriangleIcon className="size-5 shrink-0 mt-0.5" />
        <p className="text-[12.5px] font-medium leading-relaxed">
          {warningText}
        </p>
      </div>

      {/* Dynamic Description with User Name and Email */}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {formattedDescription}
      </p>
    </div>
  );
}
