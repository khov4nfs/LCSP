// Real disposable API/DB fixture for Playwright/DevTools. No browser/API response mocks or live model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { startStack, root, workerKey, contentHash, runPython } from './support/legal-portfolio-stack.mjs';
const stack = await startStack({ database: 'lcsp_w5_browser', apiPort: 3415, dbPort: 55451 });
const { q, base, seedCorpus, post, databaseUrl } = stack;
const dir = mkdtempSync(path.join(tmpdir(), 'lcsp-w5-browser-'));
mkdirSync(path.join(dir, 'src'));
writeFileSync(path.join(dir, 'src/retention.py'), 'a = 1\nb = 2\nkeep_days = 7\nc = 4\n');
writeFileSync(path.join(dir, 'README.md'), 'Notification ownership is maintained outside this repository.\n');
const locators = ['art-1','art-1::cl-1','art-2','art-2::cl-1','art-3','art-3::cl-1','art-4','art-4::cl-1','art-4::cl-1::pt-a','art-5','art-5::cl-1','art-5::cl-1::pt-a','art-5::cl-1::pt-b','art-6','art-6::cl-1'];
const hashes = Object.fromEntries(locators.map(l => [l, contentHash(`content ${l}`)]));
const corpus = await seedCorpus({ name: 'w5-browser', status: 'APPROVED', documentId: 'SYNTHETIC-NOTICE-INSTRUMENT', chunks: locators.map(locator => ({ locator, content: `content ${locator}`, contentSha256: hashes[locator] })) });
const seed = path.join(dir, 'seed.json'); writeFileSync(seed, JSON.stringify({ hashes }));
const preparation = await post('preparations', { legalCorpusVersionId: corpus, idempotencyKey: `w5-browser-${randomUUID()}` });
assert.equal(preparation.status, 202);
await runPython(path.join(root, 'deepagents/tests/vertical/scripted_preparation.py'), [base, workerKey, preparation.body.data.preparationRunId, seed, 'valid']);
const { hashSecret } = await import(path.join(root, 'apps/api/dist/src/platform/security/crypto.utils.js'));
const owner = randomUUID(), admin = randomUUID();
const password = 'W5BrowserFixturePassword!';
for (const [id, email, role] of [[owner, 'w5-browser@acme.test', 'CUSTOMER'], [admin, 'w5-admin@acme.test', 'ADMIN']]) await q('INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,$4::"AuthUserRole",now())', [id, email, hashSecret(password), role]);
let busy = false;
const receipts = [];
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  try {
    if (request.method === 'GET') { response.end(JSON.stringify({ receipts, busy })); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const { assessmentId, operation } = JSON.parse(raw);
    assert.equal((await q('SELECT "ownerId" FROM "Assessment" WHERE id=$1', [assessmentId])).rows[0]?.ownerId, owner);
    if (operation === 'repository') {
      const connection = randomUUID(), snapshot = randomUUID();
      await q('INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,\'w5\',$4,\'repo\',\'acme/repo\',\'main\',\'{}\')', [connection, assessmentId, owner, `repo-${assessmentId}`]);
      await q('INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,\'acme/repo\',$5,\'{}\',$6)', [snapshot, assessmentId, connection, `repo-${assessmentId}`, 'c'.repeat(40), owner]);
      response.end(JSON.stringify({ snapshot })); return;
    }
    assert.ok(['ask','hold','resume','complete'].includes(operation));
    assert.equal(busy, false); busy = true;
    response.statusCode = 202; response.end(JSON.stringify({ started: operation }));
    const script = operation === 'ask' ? 'hitl_root.py' : 'w5_browser_root.py';
    runPython(path.join(root, 'deepagents/tests/vertical', script), [base, workerKey, assessmentId, dir, operation], { env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: databaseUrl.split('?')[0] } }).then(result => receipts.push({ assessmentId, operation, ...result })).catch(error => receipts.push({ assessmentId, operation, error: error.message })).finally(() => { busy = false; });
  } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })); }
});
server.listen(3452, '127.0.0.1');
const fixturePath = path.join(root, 'tmp/w5-browser-fixture.json');
mkdirSync(path.dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, JSON.stringify({ api: base, fixtureControl: 'http://127.0.0.1:3452', email: 'w5-browser@acme.test', adminEmail: 'w5-admin@acme.test', password, database: 'lcsp_w5_browser', repository: dir }), { mode: 0o600 });
console.log(JSON.stringify({ fixture: fixturePath, api: base, control: 'http://127.0.0.1:3452', database: 'lcsp_w5_browser', proof: 'real API/PostgreSQL/PostgresSaver; scripted model; no browser responses mocked' }));
const stop = async () => { server.close(); await stack.stop(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
