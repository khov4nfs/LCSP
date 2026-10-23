"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  activeLegalLibrarySchema,
  legalSourceChunkPageSchema,
  legalSourceChunkQuerySchema,
  legalSourceDocumentViewSchema,
  legalSourceDetailSchema,
  legalSourceListSchema,
  legalSourceVersionDetailSchema,
  type ActiveLegalLibrary,
  type CreateLegalSourceRequest,
  type CreateLegalSourceVersionRequest,
  type ImportLegalSourceDocumentRequest,
  type LegalSourceChunkPage,
  type LegalSourceDetail,
  type LegalSourceDocumentView,
  type LegalSourceList,
  type LegalSourceVersionDetail,
  type UpdateLegalSourceRequest,
  type UpdateLegalSourceDocumentEffect,
} from "@lcsp/contracts/legal-source";

import { apiNoContent, apiValidated } from "./api-request";

export const LEGAL_SOURCE_QUERY_KEYS = {
  adminList: ["admin", "legal-sources"] as const,
  source: (sourceId: string) => ["admin", "legal-sources", sourceId] as const,
  version: (versionId: string) =>
    ["admin", "legal-source-versions", versionId] as const,
  adminChunks: (versionId: string, documentRowId: string) =>
    [
      "admin",
      "legal-source-versions",
      versionId,
      "documents",
      documentRowId,
      "chunks",
    ] as const,
  library: ["legal-library"] as const,
  libraryChunks: (documentRowId: string) =>
    ["legal-library", "documents", documentRowId, "chunks"] as const,
} as const;

export function useLegalSourceListQuery() {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList,
    queryFn: () =>
      apiValidated("/api/admin/legal-sources", legalSourceListSchema),
  });
}

export function useLegalSourceQuery(sourceId: string) {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.source(sourceId),
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-sources/${encodeURIComponent(sourceId)}`,
        legalSourceDetailSchema,
      ),
    enabled: Boolean(sourceId),
  });
}

export function useLegalSourceVersionQuery(versionId: string) {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.version(versionId),
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}`,
        legalSourceVersionDetailSchema,
      ),
    enabled: Boolean(versionId),
    refetchInterval: (query) =>
      query.state.data?.documents.some(
        (document) =>
          document.ingestionState ===
            LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING ||
          document.ingestionState ===
            LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING,
      )
        ? 3000
        : false,
  });
}

export function useLegalSourceChunkPageQuery(input: {
  versionId: string;
  documentRowId: string;
  page: number;
  pageSize: number;
}) {
  const query = legalSourceChunkQuerySchema.parse({
    page: input.page,
    pageSize: input.pageSize,
  });
  const search = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  return useQuery({
    queryKey: [
      ...LEGAL_SOURCE_QUERY_KEYS.adminChunks(
        input.versionId,
        input.documentRowId,
      ),
      query.page,
      query.pageSize,
    ],
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(input.versionId)}/documents/${encodeURIComponent(input.documentRowId)}/chunks?${search}`,
        legalSourceChunkPageSchema,
      ),
  });
}

export function useActiveLegalLibraryQuery() {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.library,
    queryFn: () => apiValidated("/api/legal-library", activeLegalLibrarySchema),
  });
}

export function useLegalLibraryChunkPageQuery(input: {
  documentRowId: string;
  page: number;
  pageSize: number;
  enabled?: boolean;
}) {
  const query = legalSourceChunkQuerySchema.parse({
    page: input.page,
    pageSize: input.pageSize,
  });
  const search = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  return useQuery({
    queryKey: [
      ...LEGAL_SOURCE_QUERY_KEYS.libraryChunks(input.documentRowId),
      query.page,
      query.pageSize,
    ],
    queryFn: () =>
      apiValidated(
        `/api/legal-library/documents/${encodeURIComponent(input.documentRowId)}/chunks?${search}`,
        legalSourceChunkPageSchema,
      ),
    enabled: Boolean(input.documentRowId) && (input.enabled ?? true),
  });
}

export function useCreateLegalSourceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLegalSourceRequest) =>
      apiValidated("/api/admin/legal-sources", legalSourceDetailSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList }),
  });
}

export function useUpdateLegalSourceMutation(sourceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLegalSourceRequest) =>
      apiValidated(
        `/api/admin/legal-sources/${encodeURIComponent(sourceId)}`,
        legalSourceDetailSchema,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: (detail) => {
      client.setQueryData(LEGAL_SOURCE_QUERY_KEYS.source(sourceId), detail);
      return client.invalidateQueries({
        queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList,
      });
    },
  });
}

export function useCreateLegalSourceVersionMutation(sourceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLegalSourceVersionRequest) =>
      apiValidated(
        `/api/admin/legal-sources/${encodeURIComponent(sourceId)}/versions`,
        legalSourceVersionDetailSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: LEGAL_SOURCE_QUERY_KEYS.source(sourceId),
      }),
  });
}

export function useUploadLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    mutationFn: (body: FormData) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/upload`,
        legalSourceDocumentViewSchema,
        { method: "POST", body },
      ),
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current ? withDocument(current, document) : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useImportLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    mutationFn: (body: ImportLegalSourceDocumentRequest) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/import`,
        legalSourceDocumentViewSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current ? withDocument(current, document) : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRetryLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    mutationFn: (documentRowId: string) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(documentRowId)}/retry`,
        legalSourceDocumentViewSchema,
        { method: "POST" },
      ),
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current
          ? {
              ...current,
              documents: current.documents.map((item) =>
                item.id === document.id ? document : item,
              ),
            }
          : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRemoveLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    mutationFn: (documentRowId: string) =>
      apiNoContent(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(documentRowId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateLegalSourceDocumentEffectMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    mutationFn: ({
      documentRowId,
      ...body
    }: UpdateLegalSourceDocumentEffect & { documentRowId: string }) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(documentRowId)}/effect`,
        legalSourceDocumentViewSchema,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current
          ? {
              ...current,
              documents: current.documents.map((item) =>
                item.id === document.id ? document : item,
              ),
            }
          : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useActivateLegalSourceVersionMutation(versionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/activate`,
        legalSourceVersionDetailSchema,
        { method: "POST" },
      ),
    onSuccess: async (version) => {
      client.setQueryData(LEGAL_SOURCE_QUERY_KEYS.version(versionId), version);
      await Promise.all([
        client.invalidateQueries({
          queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList,
        }),
        client.invalidateQueries({
          queryKey: LEGAL_SOURCE_QUERY_KEYS.source(version.source.id),
        }),
      ]);
    },
  });
}

export function useDiscardLegalSourceVersionMutation(versionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiNoContent(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList }),
  });
}

function withDocument(
  version: LegalSourceVersionDetail,
  document: LegalSourceDocumentView,
): LegalSourceVersionDetail {
  const documents = [
    document,
    ...version.documents.filter((item) => item.id !== document.id),
  ];
  return {
    ...version,
    documents,
    documentCount: Math.max(version.documentCount, documents.length),
  };
}

export type LegalSourceListData = LegalSourceList;
export type LegalSourceDetailData = LegalSourceDetail;
export type LegalSourceVersionData = LegalSourceVersionDetail;
export type LegalSourceLibraryData = ActiveLegalLibrary;
export type LegalSourceChunkPageData = LegalSourceChunkPage;
