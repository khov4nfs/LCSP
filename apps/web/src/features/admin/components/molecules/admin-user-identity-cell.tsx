import { cn } from "@/lib/utils";

type AdminUserIdentityCellProps = {
  fullName: string;
  email: string;
  avatarInitial?: string;
  className?: string;
};

export function AdminUserIdentityCell({
  fullName,
  email,
  avatarInitial,
  className,
}: AdminUserIdentityCellProps) {
  const initial =
    avatarInitial ?? (fullName.charAt(0) || email.charAt(0) || "U").toUpperCase();

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initial}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-foreground">
          {fullName}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {email}
        </span>
      </div>
    </div>
  );
}
