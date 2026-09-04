"use client";

import { resolveMessage } from "@lcsp/i18n";
import {
  ArrowRightIcon,
  CheckIcon,
  Globe2Icon,
  ShieldCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspaceUiStore } from "@/features/workspace/stores/workspace-ui-store";
import { useSignOutMutation } from "@/lib/api/auth-queries";
import type { WorkspaceSelectionOption } from "@/lib/api/workspace-client";
import {
  usePersistWorkspaceSelectionMutation,
  useWorkspaceSelectionQuery,
} from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

type WorkspaceOption = WorkspaceSelectionOption;

export default function SelectWorkspacePage() {
  const router = useRouter();
  const signOutMutation = useSignOutMutation();
  const setSelectedWorkspace = useWorkspaceUiStore(
    (state) => state.setSelectedWorkspace,
  );
  const selectedWorkspaceId = useWorkspaceUiStore(
    (state) => state.selectedWorkspaceId,
  );

  const workspacesQuery = useWorkspaceSelectionQuery();
  const selectedId =
    selectedWorkspaceId ?? workspacesQuery.data?.selected_workspace_id;

  const selectWorkspace = usePersistWorkspaceSelectionMutation();

  async function handleSelectWorkspace(workspaceId: string) {
    const workspace = await selectWorkspace.mutateAsync(workspaceId);
    setSelectedWorkspace(workspace);
    router.replace("/workspace");
  }

  async function handleSignOut() {
    await signOutMutation.mutateAsync();
    setSelectedWorkspace(undefined);
    router.replace("/sign-in");
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="relative flex h-24 shrink-0 items-center justify-center px-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </span>
          <span className="text-2xl font-bold tracking-normal">
            {t("pages.appShell.productName")}
          </span>
        </div>
        <div className="absolute top-7 right-6 hidden text-right text-xs sm:block">
          <p className="text-muted-foreground">
            {t("pages.workspaceSelector.missingSomething")}
          </p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="font-semibold text-primary hover:underline"
          >
            {t("pages.workspaceSelector.signInAnotherAccount")}
          </button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-10">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-normal">
            {t("pages.workspaceSelector.welcomeBackTitle")}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {t("pages.workspaceSelector.welcomeBackDescription")}
          </p>
        </div>

        <div className="mt-16">
          <h2 className="text-lg font-bold">
            {t("pages.workspaceSelector.readyToLaunch")}
          </h2>
          {workspacesQuery.data?.email ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {workspacesQuery.data.email}
            </p>
          ) : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-sm border bg-background shadow-lg">
          {workspacesQuery.isLoading ? (
            <div className="flex items-center gap-3 px-8 py-8 text-sm text-muted-foreground">
              <Spinner data-icon="inline-start" />
              {t("pages.workspaceSelector.loading")}
            </div>
          ) : null}

          {workspacesQuery.isError ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTitle>
                  {t("pages.workspaceSelector.errorTitle")}
                </AlertTitle>
                <AlertDescription>
                  {t("pages.workspaceSelector.errorDetail")}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          {workspacesQuery.data?.workspaces.length === 0 ? (
            <div className="p-4">
              <Alert>
                <AlertTitle>
                  {t("pages.workspaceSelector.noWorkspacesTitle")}
                </AlertTitle>
                <AlertDescription>
                  {t("pages.workspaceSelector.noWorkspacesDetail")}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          <div className="divide-y">
            {workspacesQuery.data?.workspaces.map((workspace) => {
              const isSelected = workspace.id === selectedId;
              const isPending =
                selectWorkspace.isPending &&
                selectWorkspace.variables === workspace.id;

              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => void handleSelectWorkspace(workspace.id)}
                  disabled={selectWorkspace.isPending}
                  className="flex w-full items-center gap-4 px-8 py-5 text-left transition hover:bg-muted/45 disabled:cursor-wait disabled:opacity-80"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-primary text-xl font-bold text-primary-foreground">
                    {getWorkspaceInitials(workspace.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xl font-bold">
                        {workspace.name}
                      </span>
                      {isSelected ? (
                        <CheckIcon className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <MemberDots workspaceName={workspace.name} />
                      <span>{formatMembers(workspace.member_count)}</span>
                      <span aria-hidden="true">•</span>
                      <span>{formatLastSignIn(workspace)}</span>
                    </span>
                  </span>
                  {isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ArrowRightIcon className="size-6 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-6 px-6 py-8 text-sm text-muted-foreground">
        <span>{t("pages.workspaceSelector.privacyTerms")}</span>
        <span>{t("pages.workspaceSelector.contactUs")}</span>
        <span className="flex items-center gap-1.5">
          <Globe2Icon className="size-4" />
          {t("pages.workspaceSelector.changeRegion")}
        </span>
      </footer>
    </main>
  );
}

function MemberDots({ workspaceName }: { workspaceName: string }) {
  const initials = getWorkspaceInitials(workspaceName);
  const members = [initials[0] ?? "L", "P", "T", initials[1] ?? "C"];
  const colors = [
    "bg-sky-600",
    "bg-slate-700",
    "bg-fuchsia-600",
    "bg-emerald-500",
  ];

  return (
    <span className="flex -space-x-1">
      {members.map((member, index) => (
        <span
          key={`${member}-${index}`}
          className={`flex size-5 items-center justify-center rounded-sm text-xs font-semibold text-white ring-1 ring-background ${colors[index]}`}
        >
          {member}
        </span>
      ))}
    </span>
  );
}

function getWorkspaceInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatMembers(memberCount = 0) {
  return `${memberCount} ${t("pages.workspaceSelector.members")}`;
}

function formatLastSignIn(workspace: WorkspaceOption) {
  const days = workspace.last_sign_in_days_ago ?? 1;
  const suffixKey =
    days === 1
      ? "pages.workspaceSelector.dayAgo"
      : "pages.workspaceSelector.daysAgo";
  return `${t("pages.workspaceSelector.lastSignIn")} ${days} ${t(suffixKey)}`;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
