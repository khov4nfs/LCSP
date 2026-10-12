"use client";

import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { SearchIcon, XIcon } from "lucide-react";
import { resolveAppMessage } from "@/lib/i18n";
import { ArtifactEmptyState } from "./artifact-empty-state";
import { ArtifactList } from "./artifact-list";
import { ARTIFACT_TABS, type ArtifactGroup, type ArtifactTab } from "../types/artifact.types";
import { useState } from "react";
import { filterArtifactGroups } from "../utils/artifact-search";

const TAB_LABEL_KEYS = {
  ALL: "pages.artifacts.tabs.all",
  YOURS: "pages.artifacts.tabs.yours",
  SHARED_WITH_YOU: "pages.artifacts.tabs.shared_with_you",
} as const;

export function ArtifactsPage({ groups = [] }: { groups?: ArtifactGroup[] }) {
  const [tab, setTab] = useState<ArtifactTab>(ARTIFACT_TABS.all);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleGroups = tab === ARTIFACT_TABS.sharedWithYou ? [] : filterArtifactGroups(groups, query);
  return <main className="mx-auto w-full max-w-6xl px-6 py-10"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{resolveAppMessage("pages.appShell.workspaceTitle")}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{resolveAppMessage("pages.artifacts.title")}</h1></div><div className="flex items-center gap-2">{searchOpen ? <div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={resolveAppMessage("pages.artifacts.searchPlaceholder")} aria-label={resolveAppMessage("pages.artifacts.search")} className="h-10 w-56 rounded-lg border bg-background pl-9 pr-9 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring" /><button type="button" onClick={() => { setQuery(""); setSearchOpen(false); }} aria-label={resolveAppMessage("pages.artifacts.closeSearch")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><XIcon className="size-4" /></button></div> : <button type="button" onClick={() => setSearchOpen(true)} aria-label={resolveAppMessage("pages.artifacts.search")} className="inline-flex size-10 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><SearchIcon className="size-4" /></button>}<Link href="/assessments/new" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><PlusIcon className="size-4" />{resolveAppMessage("pages.artifacts.newArtifact")}</Link></div></div><div className="mt-8 flex gap-1 border-b" role="tablist" aria-label={resolveAppMessage("pages.artifacts.title")}>{Object.values(ARTIFACT_TABS).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-4 py-2 text-sm ${tab === value ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}>{resolveAppMessage(TAB_LABEL_KEYS[value])}</button>)}</div><div className="mt-8">{visibleGroups.length ? <ArtifactList groups={visibleGroups} /> : <ArtifactEmptyState />}</div></main>;
}
