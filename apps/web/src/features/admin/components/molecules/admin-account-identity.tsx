import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminAccountIdentityProps } from "../../types/admin-account.types";

export function AdminAccountIdentity({ identity }: AdminAccountIdentityProps) {
  if (!identity)
    return (
      <>
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-28" />
        </div>
      </>
    );
  return (
    <>
      <Avatar>
        <AvatarFallback className="bg-admin-status-active-surface text-xs font-semibold text-admin-status-active-foreground">
          {identity.avatarInitials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          data-admin-account-name
          className="truncate text-[12.5px] font-medium"
        >
          {identity.displayName}
        </span>
        <span
          data-admin-account-email
          className="truncate text-[10.5px] text-muted-foreground"
        >
          {identity.email}
        </span>
      </div>
    </>
  );
}
