// Delivers Legal Source activation events to the REAL consumer inside the REAL built API application,
// exactly as the RabbitMQ adapter would after the durable outbox publishes them. The disposable test
// stacks run without a broker, so this is the only seam: everything behind it (consumer -> CommandBus ->
// StartRuleSetPreparation -> PostgreSQL) is the production code path.
//   node deliver-legal-source-activation.mjs '<json: {"events":[payload...],"concurrent":true}>'
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
import { createRequire } from "node:module";

const { NestFactory } = createRequire(path.join(root, "apps/api/package.json"))("@nestjs/core");
const load = async (relative) => {
  const module = await import(pathToFileURL(path.join(root, "apps/api/dist", relative)).href);
  return { ...module, ...module.default };
};
const { AppModule } = await load("src/app.module.js");
const { LegalSourceActivatedConsumer } = await load(
  "src/modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.js",
);

const { events, concurrent } = JSON.parse(process.argv[2]);
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const consumer = app.get(LegalSourceActivatedConsumer, { strict: false });
  const results = [];
  if (concurrent) {
    results.push(...(await Promise.allSettled(events.map((event) => consumer.handle(event)))));
  } else {
    for (const event of events) {
      results.push(await consumer.handle(event).then(() => ({ status: "fulfilled" }), (reason) => ({ status: "rejected", reason: String(reason) })));
    }
  }
  console.log(JSON.stringify({ delivered: results.length, failed: results.filter((r) => r.status === "rejected").length }));
} finally {
  await app.close();
}
