"use client";

import type { ReactNode } from "react";
import type { MessageKey } from "@lcsp/i18n";

import { AdminSidebar } from "./admin-sidebar";
import { useAuthSettingsProfileQuery } from "@/lib/api/auth-queries";
import { resolveAppMessage } from "@/lib/i18n";

type AdminShellProps = {
  children: ReactNode;
  adminName?: string;
  adminEmail?: string;
};

export function AdminShell({
  children,
  adminName,
  adminEmail,
}: AdminShellProps) {
  const { data: profile } = useAuthSettingsProfileQuery();
  const fallbackName = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackName" as MessageKey,
  );
  const fallbackEmail = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackEmail" as MessageKey,
  );

  const resolvedName =
    adminName ??
    profile?.display_name ??
    (profile?.email ? profile.email.split("@")[0] : undefined) ??
    fallbackName;
  const resolvedEmail =
    adminEmail ?? profile?.email ?? fallbackEmail;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground antialiased selection:bg-primary/20">
      {/* 248px Desktop Admin Sidebar */}
      <AdminSidebar adminName={resolvedName} adminEmail={resolvedEmail} />

      {/* Main Content Surface (1192px at 1440px desktop viewport) */}
      <main className="flex min-h-screen flex-1 min-w-0 flex-col overflow-y-auto px-10 py-8">
        <div className="mx-auto w-full max-w-[1192px]">{children}</div>
      </main>
    </div>
  );
}
