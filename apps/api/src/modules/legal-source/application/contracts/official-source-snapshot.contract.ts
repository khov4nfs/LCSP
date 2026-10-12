export interface RegisterOfficialSourceSnapshotRequest {
  snapshotRef: string;
  catalogSourceRef: string;
  adminCatalogVersion: string;
  documentId: string;
  documentNumber?: string | null;
  sourceUrl: string;
  finalUrl?: string | null;
  contentType: string;
  byteLength: number;
  contentSha256: string;
  snapshotObjectKey: string;
  provenanceRef: string;
  retrievedAt: string;
  sourceEffectStatus?: string | null;
  normalizationSource?: string | null;
  documentIdentityVerified: boolean;
}

export interface OfficialSourceSnapshotRecord {
  snapshotRef: string;
  snapshotId: string;
  catalogSourceRef: string;
  adminCatalogVersion: string;
  documentId: string;
  documentNumber: string | null;
  sourceUrl: string;
  finalUrl: string | null;
  contentType: string;
  byteLength: number;
  contentSha256: string;
  snapshotObjectKey: string;
  provenanceRef: string;
  retrievedAt: string;
  sourceEffectStatus: string | null;
  normalizationSource: string | null;
  documentIdentityVerified: boolean;
  createdAt: string;
}
