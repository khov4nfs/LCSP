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
  /**
   * Business purpose: Isolate cached admin legal-source detail by source identity.
   *
   * Business rules:
   * - Keep the admin/legal-sources namespace and supplied sourceId in the key; a key is not authorization.
   *
   * Execution flow:
   * 1. Return the immutable source-detail query key.
   *
   * Failure cases:
   * - Empty identifiers are not rejected here; the consuming detail query controls whether fetching is enabled.
   *
   * Side effects:
   * - Pure cache-key construction; no API call or cache mutation.
   */
  source: (sourceId: string) => ["admin", "legal-sources", sourceId] as const,
  /**
   * Business purpose: Isolate cached admin legal-source version detail by version identity.
   *
   * Business rules:
   * - Version detail uses the admin/legal-source-versions namespace plus versionId.
   *
   * Execution flow:
   * 1. Return the immutable version-detail query key.
   *
   * Failure cases:
   * - No identifier validation occurs here; the consuming query determines eligibility.
   *
   * Side effects:
   * - Pure cache-key construction.
   */
  version: (versionId: string) =>
    ["admin", "legal-source-versions", versionId] as const,
  /**
   * Business purpose: Separate admin chunk caches for each legal-source version and document.
   *
   * Business rules:
   * - Include both versionId and documentRowId before page-specific key segments are appended.
   *
   * Execution flow:
   * 1. Return the immutable admin document-chunk key prefix.
   *
   * Failure cases:
   * - This key builder does not fetch or validate source ownership; the backend enforces access.
   *
   * Side effects:
   * - Pure cache-key construction; no document or query state changes.
   */
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
  /**
   * Business purpose: Separate customer legal-library chunk caches by document identity.
   *
   * Business rules:
   * - Use the public legal-library namespace and documentRowId; pagination is appended by the query hook.
   *
   * Execution flow:
   * 1. Return the immutable legal-library document-chunk key prefix.
   *
   * Failure cases:
   * - Absent identity is not rejected by the key builder; the library query disables fetching when it is empty.
   *
   * Side effects:
   * - Pure cache-key construction.
   */
  libraryChunks: (documentRowId: string) =>
    ["legal-library", "documents", documentRowId, "chunks"] as const,
} as const;

/**
 * Business purpose: Keep the admin legal-source list available through the shared validated API client.
 *
 * Business rules:
 * - All admin list consumers share the canonical adminList cache key; API authorization stays on the server.
 *
 * Execution flow:
 * 1. Register the list query using the canonical key and legal-source list schema.
 *
 * Failure cases:
 * - Request or response-schema failures remain query errors; no successful list is fabricated.
 *
 * Side effects:
 * - Registers a TanStack query that may fetch and cache admin legal-source metadata.
 */
export function useLegalSourceListQuery() {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList,
    /**
     * Business purpose: Fetch the canonical admin legal-source list for its query cache.
     *
     * Business rules:
     * - Use the shared API envelope/session layer and validate the returned legalSourceListSchema.
     *
     * Execution flow:
     * 1. Request /api/admin/legal-sources and return its validated list.
     *
     * Failure cases:
     * - Authorization, transport or response-schema errors reject the query instead of returning an empty successful list.
     *
     * Side effects:
     * - Performs an API GET; the query owner manages caching.
     */
    queryFn: () =>
      apiValidated("/api/admin/legal-sources", legalSourceListSchema),
  });
}

/**
 * Business purpose: Load and cache one selected admin legal source.
 *
 * Business rules:
 * - Scope cache identity to sourceId and disable fetching when sourceId is empty.
 *
 * Execution flow:
 * 1. Register the selected source's validated detail query and eligibility flag.
 *
 * Failure cases:
 * - Server and response-schema errors remain query errors; an empty selection issues no request.
 *
 * Side effects:
 * - Registers a query that may read and cache the selected source.
 */
export function useLegalSourceQuery(sourceId: string) {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.source(sourceId),
    /**
     * Business purpose: Fetch one admin legal-source detail without embedding raw identifiers into a URL.
     *
     * Business rules:
     * - Encode sourceId and validate the response as legalSourceDetailSchema through the shared API client.
     *
     * Execution flow:
     * 1. Request the selected admin source detail and return the validated result.
     *
     * Failure cases:
     * - Unavailable/unauthorized source, transport or malformed response rejects the query.
     *
     * Side effects:
     * - Performs an API GET; does not change source lifecycle.
     */
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-sources/${encodeURIComponent(sourceId)}`,
        legalSourceDetailSchema,
      ),
    enabled: Boolean(sourceId),
  });
}

/**
 * Business purpose: Keep selected legal-source version detail current while document ingestion is active.
 *
 * Business rules:
 * - Disable fetching for an empty versionId; poll every three seconds only while any document is PENDING or PROCESSING.
 *
 * Execution flow:
 * 1. Register the version-specific validated query.
 * 2. Attach the ingestion-dependent refetch interval.
 *
 * Failure cases:
 * - Request/schema errors remain query errors; absent or terminal document activity disables interval polling.
 *
 * Side effects:
 * - May fetch/cache version detail repeatedly while ingestion is active; never starts ingestion itself.
 */
export function useLegalSourceVersionQuery(versionId: string) {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.version(versionId),
    /**
     * Business purpose: Retrieve the selected admin legal-source version detail.
     *
     * Business rules:
     * - Encode versionId and validate the shared legalSourceVersionDetailSchema.
     *
     * Execution flow:
     * 1. Request the version-detail API and return its validated projection.
     *
     * Failure cases:
     * - Authorization, missing version, transport or invalid response rejects the query.
     *
     * Side effects:
     * - Performs an API GET; no version or document mutation.
     */
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}`,
        legalSourceVersionDetailSchema,
      ),
    enabled: Boolean(versionId),
    /**
     * Business purpose: Refresh ingestion progress only while a version contains active document work.
     *
     * Business rules:
     * - Any PENDING or PROCESSING document requires a 3000 ms interval; missing data or all other states disables interval polling.
     *
     * Execution flow:
     * 1. Inspect the cached document ingestion states.
     * 2. Return the active-work interval or false.
     *
     * Failure cases:
     * - Absent query data returns false; this predicate never treats an error as completed ingestion.
     *
     * Side effects:
     * - Pure polling-schedule decision; no network request occurs inside the predicate.
     */
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

/**
 * Business purpose: Page through one admin legal document's persisted chunks with validated pagination.
 *
 * Business rules:
 * - Parse page/pageSize through legalSourceChunkQuerySchema and include version, document and normalized page values in cache identity.
 *
 * Execution flow:
 * 1. Validate pagination and build its search parameters.
 * 2. Register the selected version/document's validated chunk-page query.
 *
 * Failure cases:
 * - Invalid pagination throws before query registration; API/schema errors remain query errors.
 *
 * Side effects:
 * - Registers a query that may fetch/cache legal-source chunks; no source content is changed.
 */
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
    /**
     * Business purpose: Fetch one persisted chunk page for the selected admin version and document.
     *
     * Business rules:
     * - Encode both identifiers, use normalized pagination and validate legalSourceChunkPageSchema.
     *
     * Execution flow:
     * 1. GET the selected version/document chunks with the parsed page parameters.
     *
     * Failure cases:
     * - Unauthorized/missing document, transport or response-schema failure rejects the query.
     *
     * Side effects:
     * - Reads chunk data through the API; no ingestion or chunk persistence occurs.
     */
    queryFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(input.versionId)}/documents/${encodeURIComponent(input.documentRowId)}/chunks?${search}`,
        legalSourceChunkPageSchema,
      ),
  });
}

/**
 * Business purpose: Expose the currently active legal library through a shared customer query.
 *
 * Business rules:
 * - Use the canonical library key and validate activeLegalLibrarySchema; the query does not select or activate a version.
 *
 * Execution flow:
 * 1. Register the shared active-library query.
 *
 * Failure cases:
 * - API or schema failure remains an error; missing library data is never fabricated as active.
 *
 * Side effects:
 * - May fetch/cache the active legal-library projection.
 */
export function useActiveLegalLibraryQuery() {
  return useQuery({
    queryKey: LEGAL_SOURCE_QUERY_KEYS.library,
    /**
     * Business purpose: Retrieve the API's current active legal-library projection.
     *
     * Business rules:
     * - Use /api/legal-library and validate activeLegalLibrarySchema through the shared envelope client.
     *
     * Execution flow:
     * 1. Request and return the validated active library.
     *
     * Failure cases:
     * - Transport, authorization or response-contract failures reject the query.
     *
     * Side effects:
     * - Performs an API GET; no legal-source activation.
     */
    queryFn: () => apiValidated("/api/legal-library", activeLegalLibrarySchema),
  });
}

/**
 * Business purpose: Load a selected active-library document's chunks only when the consumer enables them.
 *
 * Business rules:
 * - Validate pagination and scope cache to document/page; require a nonempty documentRowId and enabled not false.
 *
 * Execution flow:
 * 1. Parse the chunk page and construct its URL parameters.
 * 2. Register the validated library chunk query with combined eligibility.
 *
 * Failure cases:
 * - Invalid page input throws; a disabled/empty document selection makes no request; API errors remain query errors.
 *
 * Side effects:
 * - May fetch and cache a legal-library chunk page; no document mutation.
 */
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
    /**
     * Business purpose: Retrieve a customer legal-library document's selected chunk page.
     *
     * Business rules:
     * - Encode documentRowId and use the already validated page/pageSize; validate legalSourceChunkPageSchema.
     *
     * Execution flow:
     * 1. GET the library document chunk endpoint with normalized pagination.
     *
     * Failure cases:
     * - Missing/inaccessible library document or transport/schema failure rejects the query.
     *
     * Side effects:
     * - Read-only API request; cache behavior belongs to the query hook.
     */
    queryFn: () =>
      apiValidated(
        `/api/legal-library/documents/${encodeURIComponent(input.documentRowId)}/chunks?${search}`,
        legalSourceChunkPageSchema,
      ),
    enabled: Boolean(input.documentRowId) && (input.enabled ?? true),
  });
}

/**
 * Business purpose: Coordinate the client mutation to create a legal source and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-sources.
 * 2. Invalidate the admin legal-source list after creation.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Invalidates adminList only; the backend owns durable creation.
 */
export function useCreateLegalSourceMutation() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request the backend to create a legal source.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDetailSchema. Serialize the typed request body as JSON with its content type.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-sources and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: (body: CreateLegalSourceRequest) =>
      apiValidated("/api/admin/legal-sources", legalSourceDetailSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to create a legal source.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Invalidate the admin legal-source list after creation.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Invalidates adminList only; the backend owns durable creation.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList }),
  });
}

/**
 * Business purpose: Coordinate the client mutation to update the selected legal source and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for PATCH /api/admin/legal-sources/{encoded sourceId}.
 * 2. Replace the selected source cache with the returned canonical detail, then invalidate adminList.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Writes the selected source-detail cache and invalidates adminList.
 */
export function useUpdateLegalSourceMutation(sourceId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request the backend to update the selected legal source.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDetailSchema. Serialize the typed request body as JSON with its content type.
     *
     * Execution flow:
     * 1. Send PATCH /api/admin/legal-sources/{encoded sourceId} and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
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
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to update the selected legal source.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Replace the selected source cache with the returned canonical detail, then invalidate adminList.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Writes the selected source-detail cache and invalidates adminList.
     */
    onSuccess: (detail) => {
      client.setQueryData(LEGAL_SOURCE_QUERY_KEYS.source(sourceId), detail);
      return client.invalidateQueries({
        queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList,
      });
    },
  });
}

/**
 * Business purpose: Coordinate the client mutation to create a draft version under the selected legal source and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-sources/{encoded sourceId}/versions.
 * 2. Invalidate the selected source detail so its version list is refreshed.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Invalidates the selected source-detail cache.
 */
export function useCreateLegalSourceVersionMutation(sourceId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request the backend to create a draft version under the selected legal source.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceVersionDetailSchema. Serialize the typed request body as JSON with its content type.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-sources/{encoded sourceId}/versions and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
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
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to create a draft version under the selected legal source.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Invalidate the selected source detail so its version list is refreshed.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Invalidates the selected source-detail cache.
     */
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: LEGAL_SOURCE_QUERY_KEYS.source(sourceId),
      }),
  });
}

/**
 * Business purpose: Coordinate the client mutation to upload a document into the selected legal-source version and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-source-versions/{encoded versionId}/documents/upload.
 * 2. Upsert the canonical returned document into an existing version cache with withDocument, then await version invalidation.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Updates an existing version cache without creating absent cache data, then invalidates it.
 */
export function useUploadLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    /**
     * Business purpose: Request the backend to upload a document into the selected legal-source version.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDocumentViewSchema. Send FormData directly so the browser supplies its multipart boundary.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-source-versions/{encoded versionId}/documents/upload and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: (body: FormData) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/upload`,
        legalSourceDocumentViewSchema,
        { method: "POST", body },
      ),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to upload a document into the selected legal-source version.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Upsert the canonical returned document into an existing version cache with withDocument, then await version invalidation.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Updates an existing version cache without creating absent cache data, then invalidates it.
     */
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current ? withDocument(current, document) : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Business purpose: Coordinate the client mutation to import a document into the selected legal-source version and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-source-versions/{encoded versionId}/documents/import.
 * 2. Upsert the canonical imported document into an existing version cache with withDocument, then await version invalidation.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Updates an existing version cache without creating absent cache data, then invalidates it.
 */
export function useImportLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    /**
     * Business purpose: Request the backend to import a document into the selected legal-source version.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDocumentViewSchema. Serialize the typed request body as JSON with its content type.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-source-versions/{encoded versionId}/documents/import and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
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
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to import a document into the selected legal-source version.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Upsert the canonical imported document into an existing version cache with withDocument, then await version invalidation.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Updates an existing version cache without creating absent cache data, then invalidates it.
     */
    onSuccess: async (document) => {
      client.setQueryData<LegalSourceVersionDetail>(key, (current) =>
        current ? withDocument(current, document) : current,
      );
      await client.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Business purpose: Coordinate the client mutation to retry ingestion of a selected version document and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId}/retry.
 * 2. Replace only an existing matching document ID in cached version detail, then await version invalidation.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Updates matching cached document entries and invalidates the selected version; no missing document is appended.
 */
export function useRetryLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    /**
     * Business purpose: Request the backend to retry ingestion of a selected version document.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDocumentViewSchema.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId}/retry and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: (documentRowId: string) =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(documentRowId)}/retry`,
        legalSourceDocumentViewSchema,
        { method: "POST" },
      ),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to retry ingestion of a selected version document.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Replace only an existing matching document ID in cached version detail, then await version invalidation.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Updates matching cached document entries and invalidates the selected version; no missing document is appended.
     */
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

/**
 * Business purpose: Coordinate the client mutation to remove a document from the selected legal-source version and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for DELETE /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId}.
 * 2. Invalidate the selected version detail after the delete succeeds.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Invalidates the selected version cache; no optimistic document deletion occurs.
 */
export function useRemoveLegalSourceDocumentMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    /**
     * Business purpose: Request the backend to remove a document from the selected legal-source version.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate the shared no-content success contract.
     *
     * Execution flow:
     * 1. Send DELETE /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId} and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: (documentRowId: string) =>
      apiNoContent(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/documents/${encodeURIComponent(documentRowId)}`,
        { method: "DELETE" },
      ),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to remove a document from the selected legal-source version.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Invalidate the selected version detail after the delete succeeds.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Invalidates the selected version cache; no optimistic document deletion occurs.
     */
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}

/**
 * Business purpose: Coordinate the client mutation to update the recorded legal effect of a selected document and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for PATCH /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId}/effect.
 * 2. Replace only the matching cached document with the canonical returned effect projection, then await version invalidation.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Updates existing cached document entries and invalidates version detail; applicability is not decided by the cache.
 */
export function useUpdateLegalSourceDocumentEffectMutation(versionId: string) {
  const client = useQueryClient();
  const key = LEGAL_SOURCE_QUERY_KEYS.version(versionId);
  return useMutation({
    /**
     * Business purpose: Request the backend to update the recorded legal effect of a selected document.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceDocumentViewSchema. Keep documentRowId in the URL and exclude it from the JSON effect body.
     *
     * Execution flow:
     * 1. Send PATCH /api/admin/legal-source-versions/{encoded versionId}/documents/{encoded documentRowId}/effect and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
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
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to update the recorded legal effect of a selected document.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Replace only the matching cached document with the canonical returned effect projection, then await version invalidation.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Updates existing cached document entries and invalidates version detail; applicability is not decided by the cache.
     */
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

/**
 * Business purpose: Coordinate the client mutation to activate the selected legal-source version and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for POST /api/admin/legal-source-versions/{encoded versionId}/activate.
 * 2. Cache the canonical activated version, then await parallel invalidation of adminList and its owning source detail.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Writes version detail and invalidates adminList plus the returned version's source cache.
 */
export function useActivateLegalSourceVersionMutation(versionId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request the backend to activate the selected legal-source version.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate legalSourceVersionDetailSchema.
     *
     * Execution flow:
     * 1. Send POST /api/admin/legal-source-versions/{encoded versionId}/activate and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: () =>
      apiValidated(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}/activate`,
        legalSourceVersionDetailSchema,
        { method: "POST" },
      ),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to activate the selected legal-source version.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Cache the canonical activated version, then await parallel invalidation of adminList and its owning source detail.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Writes version detail and invalidates adminList plus the returned version's source cache.
     */
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

/**
 * Business purpose: Coordinate the client mutation to discard the selected legal-source version and refresh affected legal-source caches.
 *
 * Business rules:
 * - Only a successful validated API result triggers cache changes; durable authorization and state transitions remain on the server.
 *
 * Execution flow:
 * 1. Register the mutation for DELETE /api/admin/legal-source-versions/{encoded versionId}.
 * 2. Invalidate the admin legal-source list after discard succeeds.
 *
 * Failure cases:
 * - Request or response-contract failure remains a mutation error; success cache updates do not run for rejected writes.
 *
 * Side effects:
 * - May send the API mutation; Invalidates adminList; no optimistic version removal or unrelated cache mutation occurs.
 */
export function useDiscardLegalSourceVersionMutation(versionId: string) {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request the backend to discard the selected legal-source version.
     *
     * Business rules:
     * - Use the shared API client and server-owned authorization/lifecycle validation; validate the shared no-content success contract.
     *
     * Execution flow:
     * 1. Send DELETE /api/admin/legal-source-versions/{encoded versionId} and return its validated success result.
     *
     * Failure cases:
     * - Server rejection, transport failure or invalid response propagates to the mutation; no success value is fabricated.
     *
     * Side effects:
     * - Performs the specified API write; the server owns persistence and any queued ingestion or lifecycle effects.
     */
    mutationFn: () =>
      apiNoContent(
        `/api/admin/legal-source-versions/${encodeURIComponent(versionId)}`,
        {
          method: "DELETE",
        },
      ),
    /**
     * Business purpose: Refresh legal-source client state after the backend accepted the request to discard the selected legal-source version.
     *
     * Business rules:
     * - Use the canonical returned resource where present; preserve absent version cache state and avoid optimistic claims before API success.
     *
     * Execution flow:
     * 1. Invalidate the admin legal-source list after discard succeeds.
     *
     * Failure cases:
     * - Cache refresh/invalidation failures propagate to TanStack mutation handling; they do not roll back an already accepted server mutation.
     *
     * Side effects:
     * - Invalidates adminList; no optimistic version removal or unrelated cache mutation occurs.
     */
    onSuccess: () =>
      client.invalidateQueries({ queryKey: LEGAL_SOURCE_QUERY_KEYS.adminList }),
  });
}

/**
 * Business purpose: Update cached version detail with the API's canonical uploaded or imported document.
 *
 * Business rules:
 * - Place the returned document first and remove older copies with the same ID; never lower a previously known documentCount.
 *
 * Execution flow:
 * 1. Prepend the canonical document to all differently identified cached documents.
 * 2. Return the updated version with the greater of prior count and visible document length.
 *
 * Failure cases:
 * - Typed malformed input propagates; the helper does not synthesize a version when the cache is absent.
 *
 * Side effects:
 * - Pure immutable cache projection; input version/documents are preserved.
 */
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
