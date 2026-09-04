"use client";

import {
  ChevronsUpDownIcon,
  LogOutIcon,
  PlugIcon,
  SettingsIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveAppMessage } from "@/lib/i18n";

type SidebarAccountMountProps = {
  navigateTo: (href: string) => void;
  onSignOut: () => void;
  signOutPending: boolean;
  userInitial: string;
  userName: string;
};

export function SidebarAccountMount({
  navigateTo,
  onSignOut,
  signOutPending,
  userInitial,
  userName,
}: SidebarAccountMountProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={resolveAppMessage("pages.appShell.accountMenu")}
            className="flex h-9 w-full items-center rounded-[7px] px-2.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            type="button"
          />
        }
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
          {userInitial}
        </span>
        <span className="ml-2.5 min-w-0 flex-1 truncate text-[13.5px] font-normal text-sidebar-foreground/90">
          {userName}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-51"
        side="top"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigateTo("/workspace/settings")}>
            <SettingsIcon />
            {resolveAppMessage("pages.appShell.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigateTo("/workspace/settings#repositories")}
          >
            <PlugIcon />
            {resolveAppMessage("pages.appShell.connectors")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={signOutPending}
            onClick={onSignOut}
            variant="destructive"
          >
            <LogOutIcon />
            {resolveAppMessage("pages.appShell.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
