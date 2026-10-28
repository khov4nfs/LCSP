// Derived source index only: no worker claim, model, audit verdict or activation.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./compliance-rule-set-stack.mjs";
const id = process.argv[2];
assert.match(id, /^[a-f0-9-]{36}$/);
const load = async relative => { const m = await import(pathToFileURL(path.join(root,"apps/api/dist/src",relative)).href); return {...m,...m.default}; };
const { PrismaService } = await load("infrastructure/prisma/prisma.service.js");
const { LegalDocumentGraphService } = await load("modules/legal-source/application/services/legal-document-graph.service.js");
const prisma = new PrismaService();
try { console.log(JSON.stringify(await new LegalDocumentGraphService(prisma).materialize(id))); }
finally { await prisma.$disconnect(); }
