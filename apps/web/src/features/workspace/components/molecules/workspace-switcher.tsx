"use client";

import { useEffect, useRef, useState } from "react";
import { resolveMessage } from "@lcsp/i18n";
import { Building2Icon, ChevronsUpDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceUiStore } from "@/features/workspace/stores/workspace-ui-store";
import {
  usePersistWorkspaceSelectionMutation,
  useWorkspaceSelectionQuery,
} from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { WorkspaceMenuRow } from "./workspace-menu-row";
import { WORKSPACE_MENU_ROW_STATES } from "../../types/workspace-menu-row.types";

export function WorkspaceSwitcher({
  placement,
}: {
  placement: "header" | "sidebar";
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const selectedWorkspaceId = useWorkspaceUiStore(
    (state) => state.selectedWorkspaceId,
  );
  const selectedWorkspaceName = useWorkspaceUiStore(
    (state) => state.selectedWorkspaceName,
  );
  const setSelectedWorkspace = useWorkspaceUiStore(
    (state) => state.setSelectedWorkspace,
  );
  const selectionQuery = useWorkspaceSelectionQuery();
  const selectedId =
    selectedWorkspaceId ?? selectionQuery.data?.selected_workspace_id;
  const selectedWorkspace = selectionQuery.data?.workspaces.find(
    (workspace) => workspace.id === selectedId,
  );
  const label =
    selectedWorkspaceName ??
    selectedWorkspace?.name ??
    t("pages.appShell.switchWorkspace");
  const switchWorkspace = usePersistWorkspaceSelectionMutation();

  async function handleSwitchWorkspace(workspaceId: string) {
    const workspace = await switchWorkspace.mutateAsync(workspaceId);
    setSelectedWorkspace(workspace);
    router.refresh();
  }

  useEffect(() => {
    if (selectedWorkspace && selectedWorkspaceName !== selectedWorkspace.name) {
      setSelectedWorkspace(selectedWorkspace);
    }
  }, [selectedWorkspace, selectedWorkspaceName, setSelectedWorkspace]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && switcherRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (selectionQuery.isError) {
    return null;
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      ref={switcherRef}
      className={cn("relative", placement === "header" ? "ml-auto" : "w-full")}
    >
      <Tooltip>
        <CollapsibleTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={placement === "header" ? "outline" : "ghost"}
                  size={placement === "header" ? "sm" : "default"}
                  className={
                    placement === "header"
                      ? "max-w-56 justify-between"
                      : "w-full justify-between px-2"
                  }
                />
              }
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </CollapsibleTrigger>
        <TooltipContent side={placement === "header" ? "bottom" : "right"}>
          {t("pages.appShell.switchWorkspace")}
        </TooltipContent>
      </Tooltip>
      <CollapsibleContent
        className={cn(
          "absolute top-full z-50 mt-2 w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
          placement === "header" ? "right-0" : "left-0",
        )}
      >
        {selectionQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-md px-2 py-3 text-sm text-muted-foreground">
            <Spinner data-icon="inline-start" />
            {t("pages.workspaceSelector.loading")}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          {selectedWorkspace ? (
            <WorkspaceMenuRow
              workspace={selectedWorkspace}
              state={WORKSPACE_MENU_ROW_STATES.current}
              pending={switchWorkspace.isPending}
              onSelect={() => undefined}
            />
          ) : null}
          {selectionQuery.data?.workspaces
            .filter((workspace) => workspace.id !== selectedId)
            .map((workspace) => (
              <WorkspaceMenuRow
                key={workspace.id}
                workspace={workspace}
                state={
                  switchWorkspace.variables === workspace.id
                    ? WORKSPACE_MENU_ROW_STATES.pending
                    : WORKSPACE_MENU_ROW_STATES.default
                }
                pending={
                  switchWorkspace.isPending &&
                  switchWorkspace.variables === workspace.id
                }
                onSelect={() => {
                  void handleSwitchWorkspace(workspace.id);
                  setIsOpen(false);
                }}
              />
            ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
