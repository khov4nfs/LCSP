"use client";

import { useState } from "react";
import {
  Compass,
  Users,
  BookOpen,
  FileCheck,
  Languages,
  Cpu,
  Receipt,
  Sparkles,
} from "lucide-react";

import { QuickActionRow } from "@/components/molecules/quick-action-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    id: "operations",
    label: "Operations overview",
    description: "Review operational indicators",
    href: "/admin/overview",
    icon: Compass,
  },
  {
    id: "users",
    label: "User accounts",
    description: "Manage platform accounts",
    href: "/admin/users",
    icon: Users,
  },
  {
    id: "legal-sources",
    label: "Legal sources",
    description: "Manage source documents",
    href: "/admin/legal-sources",
    icon: BookOpen,
  },
  {
    id: "rule-sets",
    label: "Rule sets",
    description: "Review prepared requirements",
    href: "/admin/compliance-rule-sets",
    icon: FileCheck,
  },
  {
    id: "translation",
    label: "Translation review",
    description: "Review translation candidates",
    href: "/admin/legal-sources",
    icon: Languages,
  },
  {
    id: "ai-usage",
    label: "AI usage",
    description: "Review model token usage",
    href: "/admin/usage",
    icon: Cpu,
  },
  {
    id: "billing",
    label: "Billing",
    description: "Review payments and exceptions",
    href: "/admin/billing",
    icon: Receipt,
  },
];

/**
 * Business purpose: Provide keyboard-accessible quick navigation across Admin console destinations aligned to Figma overlay 1828:13667.
 * Business rules:
 * - Exposes only admin-authorized routes and closes the overlay immediately when any destination is selected.
 * - Reuses shared QuickActionRow (1828:13593) and semantic globals.css tokens.
 * Execution flow:
 * 1. Render trigger button for Quick actions.
 * 2. Render Dialog with accessible QuickActionRow links.
 * Failure cases:
 * - Controlled open state prevents orphaned modal overlays.
 * Side effects:
 * - Local open state toggle and Next.js route navigation.
 */
export function AdminQuickActionsDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-figma-node="1828:13707"
        data-figma-name="Action / Quick actions"
        className={cn(
          "h-8 cursor-pointer gap-1.5 rounded-lg border-border bg-background px-3 text-xs font-semibold text-foreground shadow-xs hover:bg-muted",
          className,
        )}
      >
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        <span>Quick actions</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-figma-node="1828:13667"
          data-figma-name="Prototype overlay / Next quick actions · Admin"
          data-component="AdminQuickActionsDialog"
          className="max-w-146 rounded-2xl border-border bg-background p-6 shadow-2xl"
        >
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Quick actions
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Jump to a workspace destination.
            </DialogDescription>
          </DialogHeader>

          <nav
            aria-label="Quick actions"
            className="mt-4 grid max-h-95 grid-cols-1 gap-2.5 overflow-y-auto pr-1"
          >
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <QuickActionRow
                  key={action.id}
                  href={action.href}
                  label={action.label}
                  description={action.description}
                  icon={<Icon className="size-4" aria-hidden="true" />}
                  onClick={() => setOpen(false)}
                />
              );
            })}
          </nav>
        </DialogContent>
      </Dialog>
    </>
  );
}
