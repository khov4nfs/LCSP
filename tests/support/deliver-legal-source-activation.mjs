// Deliver source events without implicit preparation. Historical publication fixtures may explicitly request
// the existing StartRuleSetPreparation command in the same isolated stack; production activation has no start authority.
import path from "node:path";
import {
  RULE_SET_PREPARATION_SYSTEM_ACTOR,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
import { createRequire } from "node:module";

const { NestFactory } = createRequire(path.join(root, "apps/api/package.json"))(
  "@nestjs/core",
);
const load = async (relative) => {
  const module = await import(
    pathToFileURL(path.join(root, "apps/api/dist", relative)).href
  );
  return { ...module, ...module.default };
};
const { AppModule } = await load("src/app.module.js");
const { LegalSourceActivatedConsumer } = await load(
  "src/modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.js",
);

const {
  events,
  concurrent,
  startHistoricalPreparation = false,
} = JSON.parse(process.argv[2]);
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const consumer = app.get(LegalSourceActivatedConsumer, { strict: false });
  const handle = async (event) => {
    await consumer.handle(event);
    if (startHistoricalPreparation) {
      const { CommandBus } = createRequire(
        path.join(root, "apps/api/package.json"),
      )("@nestjs/cqrs");
      const { StartRuleSetPreparationCommand } = await load(
        "src/modules/compliance-rule-set/application/commands/start-rule-set-preparation/start-rule-set-preparation.command.js",
      );
      await app.get(CommandBus).execute(
        new StartRuleSetPreparationCommand(
          {
            legalSourceVersionId: event.legalSourceVersionId,
            idempotencyKey: ruleSetPreparationIdempotencyKey(
              event.legalSourceVersionId,
            ),
          },
          RULE_SET_PREPARATION_SYSTEM_ACTOR,
          event.correlationId,
        ),
      );
    }
  };
  const results = [];
  if (concurrent) {
    results.push(
      ...(await Promise.allSettled(events.map((event) => handle(event)))),
    );
  } else {
    for (const event of events) {
      results.push(
        await handle(event).then(
          () => ({ status: "fulfilled" }),
          (reason) => ({ status: "rejected", reason: String(reason) }),
        ),
      );
    }
  }
  console.log(
    JSON.stringify({
      delivered: results.length,
      failed: results.filter((r) => r.status === "rejected").length,
    }),
  );
} finally {
  await app.close();
}
