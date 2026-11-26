"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";

import {
  DOCUMENT_VIEW_MODES,
  type DocumentViewMode,
} from "@/components/molecules/gallery-list-toggle";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { DocumentCollection } from "@/components/organisms/document-collection";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

import {
  ARTIFACT_STATUSES,
  ARTIFACT_TABS,
  type ArtifactGroup,
  type ArtifactTab,
} from "../types/artifact.types";
import { filterArtifactGroups } from "../utils/artifact-search";
import { ArtifactEmptyState } from "./artifact-empty-state";
import { ArtifactList } from "./artifact-list";

const TAB_LABEL_KEYS = {
  ALL: "pages.artifacts.tabs.all",
  YOURS: "pages.artifacts.tabs.yours",
  SHARED_WITH_YOU: "pages.artifacts.tabs.shared_with_you",
} as const;

/**
 * Business purpose: Render the Artifact Library page (Figma Frame 28 `1662:2371`) reusing M10 shared `DocumentCollection`, `DocumentGalleryCard`, and `GalleryListToggle`.
 * Business rules:
 * - Gallery and List modes share the exact same tab, search query, and `visibleGroups` dataset.
 * - Only authorized available artifacts expose open/download links via `buildArtifactOpenTarget`.
 * Execution flow:
 * 1. Filter `groups` by active tab and search query.
 * 2. Compute summary metrics (`total`, `available`, `pending`).
 * 3. Render tabs and `DocumentCollection` switching between `ArtifactList` gallery and list views.
 * Failure cases:
 * - Empty `visibleGroups` renders `ArtifactEmptyState`.
 * Side effects:
 * - Pure client state for tab, search query, and gallery/list mode.
 */
export function ArtifactsPage({ groups = [] }: { groups?: ArtifactGroup[] }) {
  const [tab, setTab] = useState<ArtifactTab>(ARTIFACT_TABS.all);
  const [mode, setMode] = useState<DocumentViewMode>(
    DOCUMENT_VIEW_MODES.gallery,
  );
  const [query, setQuery] = useState("");

  const visibleGroups = useMemo(
    () =>
      tab === ARTIFACT_TABS.sharedWithYou
        ? []
        : filterArtifactGroups(groups, query),
    [groups, query, tab],
  );

  const flatArtifacts = useMemo(
    () => visibleGroups.flatMap((group) => group.artifacts),
    [visibleGroups],
  );
  const availableCount = flatArtifacts.filter(
    (item) => item.status === ARTIFACT_STATUSES.ready,
  ).length;
  const pendingCount = flatArtifacts.length - availableCount;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {resolveAppMessage("pages.appShell.workspaceTitle")}
          </p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {resolveAppMessage("pages.artifacts.title")}
          </h1>
        </div>

        <Link
          href="/assessments/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          {resolveAppMessage("pages.artifacts.newArtifact")}
        </Link>
      </header>

      <section
        aria-label={resolveAppMessage("pages.artifacts.title")}
        className="grid gap-4 sm:grid-cols-3"
      >
        <NextMetricCard
          label={resolveAppMessage("pages.artifacts.title")}
          value={flatArtifacts.length.toLocaleString(appLocale)}
          context={resolveAppMessage("pages.artifacts.tabs.all")}
          variant={NEXT_METRIC_VARIANTS.ready}
        />
        <NextMetricCard
          label={resolveAppMessage("pages.workspace.tracking.statusCompleted")}
          value={availableCount.toLocaleString(appLocale)}
          context={resolveAppMessage("pages.artifacts.open")}
        />
        <NextMetricCard
          label={resolveAppMessage("pages.workspace.tracking.statusRunning")}
          value={pendingCount.toLocaleString(appLocale)}
          context={resolveAppMessage("pages.artifacts.tabs.yours")}
        />
      </section>

      <div
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label={resolveAppMessage("pages.artifacts.title")}
      >
        {Object.values(ARTIFACT_TABS).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === value
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {resolveAppMessage(TAB_LABEL_KEYS[value])}
          </button>
        ))}
      </div>

      <DocumentCollection
        mode={mode}
        onModeChange={setMode}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder={resolveAppMessage(
          "pages.artifacts.searchPlaceholder",
        )}
        isEmpty={visibleGroups.length === 0}
        emptySlot={<ArtifactEmptyState />}
        galleryView={
          <ArtifactList groups={visibleGroups} mode={DOCUMENT_VIEW_MODES.gallery} />
        }
        listView={
          <ArtifactList groups={visibleGroups} mode={DOCUMENT_VIEW_MODES.list} />
        }
      />
    </main>
  );
}
