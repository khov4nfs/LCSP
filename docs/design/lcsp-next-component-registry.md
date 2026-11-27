# LCSP Next Design System & Component Registry (M24)

Reference Figma frames:
- **Visual Foundation**: `1665:1516`
- **Data UI State Matrix**: `1685:3275`
- **Semantic Tokens**: `apps/web/src/app/globals.css` (`--bento-*`, `--status-*`, `--metric-*`, Geist typography, Tailwind v4.3 utilities)

## Canonical Shared Primitives

| Component | Figma Master(s) | Source Path | Consuming Modules / Routes |
| --- | --- | --- | --- |
| `StatusBadge` | `LCSP Data / Status / success\|warning\|danger\|info` (`1681:1297`..`1681:1303`) | `apps/web/src/components/atoms/status-badge.tsx` | `LegalSourceLifecycleBadge`, `ReviewStatusBadge`, `AdminPaymentStatusBadge`, `PaymentStatusBadge` |
| `PanelState` | `LCSP Data / Panel state / Populated\|Empty\|Loading\|Error\|Stale` (`1681:1307`..`1681:1338`) | `apps/web/src/components/molecules/panel-state.tsx` | `LegalSourcesPage`, `LegalSourceDetailPage` |
| `NextMetricCard` | `LCSP Next / Metric / Embedded analytics\|Needs attention\|Ready\|Financial & usage` (`1826:13594`, `1826:13600`, `1826:13606`, `1837:14045`) | `apps/web/src/components/molecules/next-metric-card.tsx` | `WalletBalanceCard`, `CustomerUsageSummary`, `AdminTrackingPage`, `AdminUsageMetrics`, `AdminOperationalPrioritiesCard`, `LocalizationOperationsQueue` |
| `CollectionMetricCard` | `LCSP Next / Metric / Collection spotlight\|indicator` (`1839:13910`, `1839:13914`) | `apps/web/src/components/molecules/collection-metric-card.tsx` | `LegalSourcesPage`, `LegalSourceDetailPage`, `ComplianceRuleSetsPage`, `LegalRuleCatalogBatch` |
| `QuickActionRow` | `LCSP Next / Quick action row` (`1828:13593`) | `apps/web/src/components/molecules/quick-action-row.tsx` | `QuickActionsDialog` (Customer), `AdminQuickActionsDialog` (Admin) |
| `DocumentCollection`, `DocumentGalleryCard`, `GalleryListToggle` | `LCSP Next / Document gallery card` (`1831:13681`) | `apps/web/src/components/organisms/document-collection.tsx`, `apps/web/src/components/molecules/document-gallery-card.tsx`, `apps/web/src/components/molecules/gallery-list-toggle.tsx` | `ReportsPage`, `ArtifactsPage` |
| `LCSPLogo` | `DS Brand` (`1104:31791`), `Logo Mark` (`1105:31795`), `Logo Lockup` (`1106:31809`) | `apps/web/src/components/atoms/lcsp-logo.tsx` | `AppSidebar`, `AdminSidebar`, `AuthShell`, `MarketingShell` |
| `Button`, `Input`, `Select`, `Checkbox`, `Switch`, `Field`, `Card`, `Dialog`, `Sheet`, `Table`, `Alert`, `Empty`, `Skeleton`, `Tooltip` | `LCSP shadcn/*` (`1709:7745`, `1709:7687`, `1709:7732`, `1711:8138`, `1711:8843`, `1711:8840`) | `apps/web/src/components/ui/*` | All M01–M23 feature modules |
