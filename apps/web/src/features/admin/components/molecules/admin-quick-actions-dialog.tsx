"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Compass,
  Users,
  BookOpen,
  FileCheck,
  Languages,
  Cpu,
  Receipt,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
          "h-8 gap-1.5 rounded-lg border-[#D6DFE7] bg-white px-3 text-xs font-semibold text-[#101C29] shadow-xs hover:bg-slate-50 cursor-pointer",
          className,
        )}
      >
        <Sparkles className="size-3.5 text-[#11545B]" />
        <span>Quick actions</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-figma-node="1828:13667"
          data-figma-name="Prototype overlay / Next quick actions · Admin"
          className="max-w-[584px] rounded-2xl border-[#D6DFE7] bg-white p-6 shadow-2xl"
        >
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-[#101C29]">
              Quick actions
            </DialogTitle>
            <DialogDescription className="text-sm text-[#48586A]">
              Jump to a workspace destination.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid grid-cols-1 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.id}
                  href={action.href}
                  onClick={() => setOpen(false)}
                  className="group flex items-center justify-between rounded-xl border border-[#E5EDF2] bg-[#F7FAFC] p-3 transition-colors hover:border-[#11545B]/40 hover:bg-[#EEF7F8]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white border border-[#D6DFE7] text-[#11545B] shadow-2xs group-hover:bg-[#11545B] group-hover:text-white transition-colors">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#101C29] truncate">
                        {action.label}
                      </p>
                      <p className="text-xs text-[#48586A] truncate">
                        {action.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-[#718498] group-hover:text-[#11545B] group-hover:translate-x-0.5 transition-all" />
                </Link>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
