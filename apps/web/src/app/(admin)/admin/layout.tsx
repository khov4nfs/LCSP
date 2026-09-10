import type { ReactNode } from "react";
import { AdminShell } from "@/features/admin/components/organisms/admin-shell";

/**
 * Isolated Admin Route Layout.
 * Encloses all /admin/* pages inside the dedicated AdminShell (sidebar + container).
 * Network-level authorization and route guarding is handled upstream by proxy.ts.
 */
export default function AdminRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}


