import type { NextRequest } from "next/server";
import {
  ADMIN_ACCOUNT_MUTATION_PATHS,
  proxyAdminAccountMutation,
} from "@/lib/server/admin-account-mutations";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAdminAccountMutation(
    request,
    (await params).id,
    ADMIN_ACCOUNT_MUTATION_PATHS.suspend,
  );
}
