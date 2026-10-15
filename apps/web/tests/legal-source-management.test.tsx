import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LEGAL_SOURCE_ERROR_CODES,
  LEGAL_SOURCE_IMPORT_REJECTION_REASONS,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  LEGAL_SOURCE_CHUNK_STATUSES,
  activeLegalLibrarySchema,
  legalSourceChunkPageSchema,
  legalSourceDetailSchema,
  legalSourceListSchema,
  legalSourceVersionDetailSchema,
} from "@lcsp/contracts/legal-source";

import {
  byText,
  buttons,
  click,
  installFetch,
  render,
  settle,
} from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { LEGAL_SOURCE_QUERY_KEYS } from "../src/lib/api/legal-source-queries.ts";
import { LegalSourcesPage } from "../src/features/admin/components/organisms/legal-sources-page.tsx";
import { LegalSourceVersionPage } from "../src/features/admin/components/organisms/legal-source-version-page.tsx";
import { LegalSourceChunkInspectorPage } from "../src/features/admin/components/organisms/legal-source-chunk-inspector-page.tsx";
import { LegalSourceUploadForm } from "../src/features/admin/components/molecules/legal-source-upload-form.tsx";
import { LegalSourceImportForm } from "../src/features/admin/components/molecules/legal-source-import-form.tsx";
import { LegalLibraryPage } from "../src/features/legal-library/components/organisms/legal-library-page.tsx";
import { LegalDocumentReaderPage } from "../src/features/legal-library/components/organisms/legal-document-reader-page.tsx";
import { importLegalSourceDocumentFormSchema } from "../src/features/admin/schemas/legal-source-form-schemas.ts";
import { legalSourceEffectFormSchema } from "../src/features/admin/schemas/legal-source-effect-form-schema.ts";

const fixtureText = await readFile(
  new URL(
    "../src/public/assets/mocks/legal-source-management.json",
    import.meta.url,
  ),
  "utf8",
);
const fixtureData = JSON.parse(fixtureText) as Record<string, unknown>;
const fixtures = {
  list: legalSourceListSchema.parse(fixtureData.list),
  source: legalSourceDetailSchema.parse(fixtureData.source),
  versionDraft: legalSourceVersionDetailSchema.parse(fixtureData.versionDraft),
  versionActive: legalSourceVersionDetailSchema.parse(
    fixtureData.versionActive,
  ),
  versionActivatable: legalSourceVersionDetailSchema.parse(
    fixtureData.versionActivatable,
  ),
  library: activeLegalLibrarySchema.parse(fixtureData.library),
  chunksPageOne: legalSourceChunkPageSchema.parse(fixtureData.chunksPageOne),
  chunksPageTwo: legalSourceChunkPageSchema.parse(fixtureData.chunksPageTwo),
};

test("source import form preserves provision status provenance and rejects unsupported certainty", () => {
  const parsed = importLegalSourceDocumentFormSchema.safeParse({
    url: "https://example.test/source.pdf",
    title: "",
    structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
    sourceEffectStatus: "",
    effectiveDate: "",
    provisionStatusesJson: JSON.stringify({
      "Article 1": {
        status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
        sourceRef: "metadata page 2",
      },
      "Article 2": { status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN },
    }),
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.provisionStatuses, {
    "Article 1": {
      status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      sourceRef: "metadata page 2",
    },
    "Article 2": { status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN },
  });

  const missingProvenance = importLegalSourceDocumentFormSchema.safeParse({
    url: "https://example.test/source.pdf",
    title: "",
    structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
    sourceEffectStatus: "",
    effectiveDate: "",
    provisionStatusesJson: JSON.stringify({
      "Article 1": { status: LEGAL_SOURCE_CHUNK_STATUSES.REPEALED },
    }),
  });
  assert.equal(missingProvenance.success, false);
});

test("draft effect metadata requires evidence for known statuses and keeps missing status unknown", () => {
  const known = legalSourceEffectFormSchema.safeParse({
    status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
    sourceRef: "official metadata, section 4",
    effectiveDate: "2026-03-01",
    provisionStatuses: JSON.stringify({
      "art-9": {
        status: LEGAL_SOURCE_CHUNK_STATUSES.REPEALED,
        sourceRef: "source article 12",
      },
    }),
  });
  assert.equal(known.success, true);
  if (known.success) {
    assert.equal(known.data.status, LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE);
    assert.equal(
      known.data.provisionStatuses["art-9"]?.status,
      LEGAL_SOURCE_CHUNK_STATUSES.REPEALED,
    );
  }

  const unknown = legalSourceEffectFormSchema.safeParse({
    status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
    sourceRef: "",
    effectiveDate: "",
    provisionStatuses: "",
  });
  assert.equal(unknown.success, true);
  if (unknown.success) {
    assert.equal(unknown.data.status, LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN);
    assert.equal(unknown.data.effectiveDate, null);
    assert.deepEqual(unknown.data.provisionStatuses, {});
  }

  assert.equal(
    legalSourceEffectFormSchema.safeParse({
      status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      sourceRef: "",
      effectiveDate: "",
      provisionStatuses: "",
    }).success,
    false,
  );
});

setAppLocale("en");

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

function renderWithClient(
  node: React.ReactElement,
  client = createQueryClient(),
) {
  return {
    client,
    container: render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
  };
}

function buttonByText(container: ParentNode, text: string) {
  return byText<HTMLButtonElement>(container, "button", text);
}

function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    input instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  act(() => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function installFetchHandler(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => void (globalThis.fetch = original);
}

function failedResult(code: string, status: number, reason?: string) {
  return Response.json(
    {
      ok: false,
      problem: {
        code,
        status,
        ...(reason ? { meta: { reason } } : {}),
      },
    },
    { status },
  );
}

test("Legal Sources list uses API data and create dialog validates a required name", async () => {
  const stub = installFetch({ "GET /api/admin/legal-sources": fixtures.list });
  try {
    const { container } = renderWithClient(<LegalSourcesPage />);
    await settle();
    assert.match(container.textContent ?? "", /Example Records Guide/);
    assert.match(container.textContent ?? "", /Active v1\.0/);
    assert.match(container.textContent ?? "", /Latest v2\.0/);

    click(buttonByText(container, "Create Legal Source"));
    await settle();
    const form = document.body.querySelector("form");
    assert.ok(form);
    click(form.querySelector('button[type="submit"]'));
    await settle();
    assert.match(document.body.textContent ?? "", /Enter a name\./);
    assert.equal(
      stub.calls.some((call) => call.method === "POST"),
      false,
    );
  } finally {
    stub.restore();
  }
});

test("version page renders each ingestion state, migrated rows and conditional polling", async () => {
  const versionId = fixtures.versionDraft.id;
  const stub = installFetch({
    [`GET /api/admin/legal-source-versions/${versionId}`]:
      fixtures.versionDraft,
  });
  try {
    const client = createQueryClient();
    const { container } = renderWithClient(
      <LegalSourceVersionPage versionId={versionId} />,
      client,
    );
    await settle();
    for (const state of ["Pending", "Processing", "Ready", "Failed"]) {
      assert.ok(container.textContent?.includes(state));
    }
    assert.match(container.textContent ?? "", /Migrated Source Note/);
    assert.match(container.textContent ?? "", /Import provenance/);
    assert.match(container.textContent ?? "", /SHA-256/);
    const migratedRow = [...container.querySelectorAll("tbody tr")].find(
      (row) => row.textContent?.includes("Migrated Source Note"),
    );
    assert.ok(migratedRow);
    assert.equal(migratedRow.querySelector('a[href$="/original"]'), null);

    const query = client.getQueryCache().find({
      queryKey: LEGAL_SOURCE_QUERY_KEYS.version(versionId),
    });
    assert.ok(query);
    const interval = Reflect.get(query.options, "refetchInterval") as (
      candidate: unknown,
    ) => number | false;
    assert.equal(typeof interval, "function");
    if (typeof interval === "function") {
      assert.equal(interval(query), 3000);
      client.setQueryData(
        LEGAL_SOURCE_QUERY_KEYS.version(versionId),
        fixtures.versionActivatable,
      );
      assert.equal(interval(query), false);
    }
  } finally {
    stub.restore();
  }
});

test("ACTIVE version is read-only and hides controls the API disallows", async () => {
  const versionId = fixtures.versionActive.id;
  const stub = installFetch({
    [`GET /api/admin/legal-source-versions/${versionId}`]:
      fixtures.versionActive,
  });
  try {
    const { container } = renderWithClient(
      <LegalSourceVersionPage versionId={versionId} />,
    );
    await settle();
    assert.match(container.textContent ?? "", /This version is read-only\./);
    for (const label of [
      "Add document",
      "Activate version",
      "Discard draft",
      "Retry ingestion",
      "Remove document",
    ]) {
      assert.equal(buttonByText(container, label), null);
    }
    const migratedRow = [...container.querySelectorAll("tbody tr")].find(
      (row) => row.textContent?.includes("Active Source Note"),
    );
    assert.ok(migratedRow);
    assert.equal(migratedRow.querySelector('a[href$="/original"]'), null);
  } finally {
    stub.restore();
  }
});

test("activation confirmation sends explicit activation and contains no review step", async () => {
  const versionId = fixtures.versionActivatable.id;
  const stub = installFetch({
    [`GET /api/admin/legal-source-versions/${versionId}`]:
      fixtures.versionActivatable,
    [`POST /api/admin/legal-source-versions/${versionId}/activate`]:
      fixtures.versionActivatable,
  });
  try {
    const { container } = renderWithClient(
      <LegalSourceVersionPage versionId={versionId} />,
    );
    await settle();
    click(buttonByText(container, "Activate version"));
    await settle();
    assert.match(
      document.body.textContent ?? "",
      /currently active version will be superseded/i,
    );
    assert.match(
      document.body.textContent ?? "",
      /new Rule Set Preparation will start/i,
    );
    assert.doesNotMatch(
      document.body.textContent ?? "",
      /review|approval|publish/i,
    );
    const confirms = buttons(document.body).filter(
      (button) => button.textContent?.trim() === "Activate version",
    );
    click(confirms.at(-1) ?? null);
    await settle();
    assert.ok(
      stub.calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith(
            `/api/admin/legal-source-versions/${versionId}/activate`,
          ),
      ),
    );
  } finally {
    stub.restore();
  }
});

test("upload form sends multipart fields and raw API call is validated by the client schema", async () => {
  const document = fixtures.versionDraft.documents[0];
  let requestBody: FormData | null = null;
  let requestUrl = "";
  const restore = installFetchHandler(async (input, init) => {
    requestUrl = String(input);
    requestBody = init?.body instanceof FormData ? init.body : null;
    return Response.json({ ok: true, data: document });
  });
  try {
    const versionId = fixtures.versionDraft.id;
    const { container } = renderWithClient(
      <LegalSourceUploadForm versionId={versionId} />,
    );
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    assert.ok(fileInput);
    selectFile(
      fileInput,
      new File(["synthetic text"], "neutral.txt", { type: "text/plain" }),
    );
    const title = container.querySelector<HTMLInputElement>(
      "#legal-source-document-title",
    );
    assert.ok(title);
    setInputValue(title, "Synthetic upload title");
    const provisionStatuses = container.querySelector<HTMLTextAreaElement>(
      "#legal-source-provision-statuses",
    );
    assert.ok(provisionStatuses);
    setInputValue(
      provisionStatuses,
      JSON.stringify({
        "Article 1": {
          status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          sourceRef: "metadata page 2",
        },
      }),
    );
    click(buttonByText(container, "Upload document"));
    await settle();
    assert.match(
      requestUrl,
      new RegExp(
        `/api/admin/legal-source-versions/${versionId}/documents/upload`,
      ),
    );
    assert.ok(requestBody);
    assert.equal((requestBody as FormData).get("file") instanceof File, true);
    assert.equal(
      (requestBody as FormData).get("title"),
      "Synthetic upload title",
    );
    assert.equal(
      (requestBody as FormData).get("structureProfile"),
      LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
    );
    assert.deepEqual(
      JSON.parse(String((requestBody as FormData).get("provisionStatuses"))),
      {
        "Article 1": {
          status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          sourceRef: "metadata page 2",
        },
      },
    );
  } finally {
    restore();
  }
});

test("upload surfaces a friendly duplicate-document error", async () => {
  const restore = installFetchHandler(async () =>
    failedResult(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentDuplicate, 409),
  );
  try {
    const { container } = renderWithClient(
      <LegalSourceUploadForm versionId={fixtures.versionDraft.id} />,
    );
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    assert.ok(fileInput);
    selectFile(
      fileInput,
      new File(["synthetic text"], "neutral.txt", { type: "text/plain" }),
    );
    click(buttonByText(container, "Upload document"));
    await settle();
    assert.match(
      container.textContent ?? "",
      /This document has already been added\./,
    );
  } finally {
    restore();
  }
});

test("upload surfaces an unsupported document type error", async () => {
  const restore = installFetchHandler(async () =>
    failedResult(
      LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentUnsupportedMediaType,
      415,
    ),
  );
  try {
    const { container } = renderWithClient(
      <LegalSourceUploadForm versionId={fixtures.versionDraft.id} />,
    );
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    assert.ok(fileInput);
    selectFile(
      fileInput,
      new File(["synthetic binary"], "neutral.bin", {
        type: "application/octet-stream",
      }),
    );
    click(buttonByText(container, "Upload document"));
    await settle();
    assert.match(
      container.textContent ?? "",
      /This file type is not supported\./,
    );
  } finally {
    restore();
  }
});

test("URL import sends its request shape and maps a URL rejection reason", async () => {
  let requestBody: string | null = null;
  const restore = installFetchHandler(async (_input, init) => {
    requestBody = typeof init?.body === "string" ? init.body : null;
    return failedResult(
      LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.importUrlRejected,
      422,
      LEGAL_SOURCE_IMPORT_REJECTION_REASONS.SCHEME_NOT_HTTPS,
    );
  });
  try {
    const { container } = renderWithClient(
      <LegalSourceImportForm versionId={fixtures.versionDraft.id} />,
    );
    const url = container.querySelector<HTMLInputElement>(
      "#legal-source-import-url",
    );
    assert.ok(url);
    setInputValue(url, "http://example.org/document.txt");
    click(buttonByText(container, "Import document"));
    await settle();
    assert.ok(requestBody);
    const request = JSON.parse(requestBody as string) as Record<
      string,
      unknown
    >;
    assert.equal(request.url, "http://example.org/document.txt");
    assert.equal(
      request.structureProfile,
      LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
    );
    assert.match(container.textContent ?? "", /Use an HTTPS URL\./);
  } finally {
    restore();
  }
});

test("chunk inspector pages through the API", async () => {
  const documentRowId = fixtures.versionDraft.documents[0].id;
  const calls: string[] = [];
  const restore = installFetchHandler(async (input) => {
    const url = String(input);
    calls.push(url);
    const requestedPage = new URL(url, "http://localhost").searchParams.get(
      "page",
    );
    return Response.json({
      ok: true,
      data:
        requestedPage === "2" ? fixtures.chunksPageTwo : fixtures.chunksPageOne,
    });
  });
  try {
    const { container } = renderWithClient(
      <LegalSourceChunkInspectorPage
        versionId={fixtures.versionDraft.id}
        documentRowId={documentRowId}
      />,
    );
    await settle();
    assert.match(
      container.textContent ?? "",
      /Synthetic first provision content\./,
    );
    assert.match(container.textContent ?? "", /Effective/);
    assert.match(container.textContent ?? "", /Schedule A, section 1/);
    click(buttonByText(container, "Next page"));
    await settle();
    assert.match(
      container.textContent ?? "",
      /Synthetic second provision content\./,
    );
    assert.ok(
      calls.some(
        (url) =>
          new URL(url, "http://localhost").searchParams.get("page") === "2",
      ),
    );
  } finally {
    restore();
  }
});

test("Legal Library and document reader render active API data and the empty state", async () => {
  const document = fixtures.library.documents[0];
  const stub = installFetch({
    "GET /api/legal-library": fixtures.library,
    [`GET /api/legal-library/documents/${document.id}/chunks`]:
      fixtures.chunksPageOne,
  });
  try {
    const { container: list } = renderWithClient(<LegalLibraryPage />);
    await settle();
    assert.match(list.textContent ?? "", /Active Source Note/);
    assert.match(list.textContent ?? "", /Open official source/);
    assert.doesNotMatch(
      list.textContent ?? "",
      /Risk level|Processed legal risk/i,
    );

    const { container: reader } = renderWithClient(
      <LegalDocumentReaderPage documentRowId={document.id} />,
    );
    await settle();
    assert.match(
      reader.textContent ?? "",
      /Synthetic first provision content\./,
    );
    assert.equal(reader.querySelector("iframe"), null);
  } finally {
    stub.restore();
  }

  const emptyResponse = failedResult(
    LEGAL_SOURCE_ERROR_CODES.activeLegalSourceNotFound,
    404,
  );
  const emptyStub = installFetch({ "GET /api/legal-library": emptyResponse });
  try {
    const { container } = renderWithClient(<LegalLibraryPage />);
    await settle();
    assert.match(container.textContent ?? "", /No active Legal Source Version/);
  } finally {
    emptyStub.restore();
  }
});
