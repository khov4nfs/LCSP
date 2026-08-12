import { Injectable } from "@nestjs/common";
import {
  ADMIN_SOURCE_CATALOG_IDS,
  ADMIN_SOURCE_DOCUMENT_TYPES,
  ADMIN_SOURCE_HIERARCHIES,
  ADMIN_SOURCE_PATH_POLICIES,
  type AdminSourceCatalogId,
  type GetAdminSourceCatalogInput,
} from "@lcsp/contracts/evidence";

type CatalogEntry = {
  catalogId: AdminSourceCatalogId;
  allowedHost: string;
  sourceHierarchy: (typeof ADMIN_SOURCE_HIERARCHIES)[keyof typeof ADMIN_SOURCE_HIERARCHIES];
  pathPolicy: (typeof ADMIN_SOURCE_PATH_POLICIES)[keyof typeof ADMIN_SOURCE_PATH_POLICIES];
};

type CatalogResolution =
  | {
      kind: "resolved";
      entry: CatalogEntry;
      documentIdentity: GetAdminSourceCatalogInput["documentIdentity"] | null;
      evidenceRef: string;
    }
  | { kind: "missing"; reason: string }
  | { kind: "conflict"; reason: string };

const ADMIN_SOURCE_CATALOG_VERSION = "catalog_v2026_08";

const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  {
    catalogId: ADMIN_SOURCE_CATALOG_IDS.vbpl,
    allowedHost: "vbpl.vn",
    sourceHierarchy: ADMIN_SOURCE_HIERARCHIES.primary,
    pathPolicy: ADMIN_SOURCE_PATH_POLICIES.officialDocument,
  },
  {
    catalogId: ADMIN_SOURCE_CATALOG_IDS.vanbanChinhPhu,
    allowedHost: "vanban.chinhphu.vn",
    sourceHierarchy: ADMIN_SOURCE_HIERARCHIES.primary,
    pathPolicy: ADMIN_SOURCE_PATH_POLICIES.officialDocument,
  },
] as const;

@Injectable()
export class AdminSourceCatalogService {
  readonly catalogVersion = ADMIN_SOURCE_CATALOG_VERSION;

  resolve(input: GetAdminSourceCatalogInput): CatalogResolution {
    if (input.catalogId) {
      const entry = CATALOG_ENTRIES.find(
        (item) => item.catalogId === input.catalogId,
      );
      if (!entry) {
        return {
          kind: "missing",
          reason: "The requested admin-managed catalog source is unavailable.",
        };
      }
      return {
        kind: "resolved",
        entry,
        documentIdentity: input.documentIdentity ?? null,
        evidenceRef: this.catalogSourceRef(
          entry.allowedHost,
          input.documentIdentity,
        ),
      };
    }

    if (!input.documentIdentity) {
      return {
        kind: "missing",
        reason: "A catalog ID or normalized document identity is required.",
      };
    }

    const candidates = this.resolveCandidates(input.documentIdentity);
    if (candidates.length === 0) {
      return {
        kind: "missing",
        reason:
          "The admin-managed official catalog does not contain a unique source for this identity.",
      };
    }
    if (candidates.length > 1) {
      return {
        kind: "conflict",
        reason:
          "The document identity maps to multiple admin-managed official sources and needs an explicit catalog ID.",
      };
    }
    const [entry] = candidates;
    return {
      kind: "resolved",
      entry,
      documentIdentity: input.documentIdentity,
      evidenceRef: this.catalogSourceRef(
        entry.allowedHost,
        input.documentIdentity,
      ),
    };
  }

  private resolveCandidates(
    identity: NonNullable<GetAdminSourceCatalogInput["documentIdentity"]>,
  ): CatalogEntry[] {
    const documentType = identity.documentType;
    const authority = normalize(identity.issuingAuthority);

    if (
      authority === "CHINH PHU" &&
      documentType === ADMIN_SOURCE_DOCUMENT_TYPES.decree
    ) {
      return [
        byId(ADMIN_SOURCE_CATALOG_IDS.vbpl),
        byId(ADMIN_SOURCE_CATALOG_IDS.vanbanChinhPhu),
      ];
    }

    if (
      authority === "QUOC HOI" &&
      (documentType === ADMIN_SOURCE_DOCUMENT_TYPES.law ||
        documentType === ADMIN_SOURCE_DOCUMENT_TYPES.resolution)
    ) {
      return [byId(ADMIN_SOURCE_CATALOG_IDS.vbpl)];
    }

    if (
      authority.startsWith("BO ") &&
      documentType === ADMIN_SOURCE_DOCUMENT_TYPES.circular
    ) {
      return [byId(ADMIN_SOURCE_CATALOG_IDS.vbpl)];
    }

    return [];
  }

  private catalogSourceRef(
    host: string,
    documentIdentity: GetAdminSourceCatalogInput["documentIdentity"],
  ): string {
    if (!documentIdentity) {
      return `catalog-source:${host}:catalog`;
    }
    const number = slug(documentIdentity.documentNumber);
    return `catalog-source:${host}:${documentIdentity.documentType.toLowerCase()}:${number}`;
  }
}

function byId(catalogId: AdminSourceCatalogId): CatalogEntry {
  const entry = CATALOG_ENTRIES.find((item) => item.catalogId === catalogId);
  if (!entry) {
    throw new Error(`Unknown catalog entry: ${catalogId}`);
  }
  return entry;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 96);
}
