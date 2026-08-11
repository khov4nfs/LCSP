import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { getLegalDocument } from "@/features/legal-library/config/legal-documents";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lawId: string }> },
) {
  const { lawId } = await params;
  const document = getLegalDocument(lawId);

  if (!document) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const file = await readLegalDocument(document.fileName);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Disposition": `inline; filename="${document.fileName}"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

async function readLegalDocument(fileName: string): Promise<Buffer> {
  const directories = [
    process.env.LCSP_LEGAL_DOCUMENTS_DIR,
    path.join(process.cwd(), "reports"),
    path.resolve(process.cwd(), "../../reports"),
  ].filter((directory): directory is string => Boolean(directory));

  for (const directory of directories) {
    try {
      return await readFile(path.join(directory, fileName));
    } catch {
      // Try the next deployment-compatible source directory.
    }
  }

  throw new Error("Legal document file is unavailable");
}
