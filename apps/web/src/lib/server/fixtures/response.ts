import { readFile } from "node:fs/promises";
import path from "node:path";

import type { NextResponse } from "next/server";

import { successJson } from "@/lib/server/problem-json";

const MOCK_ASSET_PATH_SEGMENTS = ["src", "public", "assets", "mocks"] as const;

export function isMockModeEnabled(): boolean {
  return false;
}

export async function mockJsonResponse(
  filename: string,
): Promise<NextResponse | null> {
  if (!isMockModeEnabled()) {
    return null;
  }

  return successJson(await readMockJson(filename));
}

export async function readMockJson<T = unknown>(filename: string): Promise<T> {
  const filePath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ...MOCK_ASSET_PATH_SEGMENTS,
    filename,
  );
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
