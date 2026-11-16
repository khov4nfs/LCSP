import { authoredTranslationProvider } from "./authored-translation-provider.js";

const names = [
  "LCSP_AUTHORED_TRANSLATION_URL",
  "LCSP_AUTHORED_TRANSLATION_KEY",
  "LCSP_AGENT_SERVER_URL",
  "WORKER_API_KEY",
];
const original = new Map(names.map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const name of names) delete process.env[name];
});
afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it("uses the native endpoint and worker credential without separate translation credentials", () => {
  process.env.LCSP_AGENT_SERVER_URL = "http://agent-server:8000/";
  process.env.WORKER_API_KEY = "native-key";
  expect(authoredTranslationProvider()).toEqual({
    url: "http://agent-server:8000/internal/authored-translation",
    headers: { "x-worker-api-key": "native-key" },
  });
});

it("preserves explicit external provider routing without leaking the worker credential", () => {
  process.env.LCSP_AUTHORED_TRANSLATION_URL =
    "https://provider.example/translate";
  process.env.LCSP_AUTHORED_TRANSLATION_KEY = "external-key";
  process.env.WORKER_API_KEY = "private-key";
  expect(authoredTranslationProvider()).toEqual({
    url: "https://provider.example/translate",
    headers: { Authorization: "Bearer external-key" },
  });
  delete process.env.LCSP_AUTHORED_TRANSLATION_KEY;
  expect(authoredTranslationProvider()).toBeNull();
});

it("does not report native readiness when address or worker credential is missing", () => {
  expect(authoredTranslationProvider()).toBeNull();
  process.env.LCSP_AGENT_SERVER_URL = "http://agent-server:8000";
  expect(authoredTranslationProvider()).toBeNull();
});

it("does not use native routing when only the external key is configured", () => {
  process.env.LCSP_AUTHORED_TRANSLATION_KEY = "external-key";
  process.env.LCSP_AGENT_SERVER_URL = "http://agent-server:8000";
  process.env.WORKER_API_KEY = "native-key";
  expect(authoredTranslationProvider()).toBeNull();
});

it.each([
  "not-a-url",
  "file:///private/translation",
  "ftp://provider.example/translate",
])("treats invalid or unsupported provider URL %s as unavailable", (url) => {
  process.env.LCSP_AGENT_SERVER_URL = url;
  process.env.WORKER_API_KEY = "native-key";
  expect(authoredTranslationProvider()).toBeNull();
  process.env.LCSP_AUTHORED_TRANSLATION_URL = url;
  process.env.LCSP_AUTHORED_TRANSLATION_KEY = "external-key";
  expect(authoredTranslationProvider()).toBeNull();
});
