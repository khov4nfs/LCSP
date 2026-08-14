process.env.NODE_ENV = "test";
process.env.RABBITMQ_URL ??= "amqp://guest:guest@127.0.0.1:5672";
process.env.RABBITMQ_EXCHANGE ??= "lcsp.events.test";
process.env.OUTBOX_POLL_INTERVAL_MS ??= "60000";
process.env.AUTH_BCRYPT_COST ??= "10";
process.env.AUTH_SESSION_TTL_SECONDS ??= "86400";
process.env.JWT_SECRET ??= "test-only-jwt-secret-at-least-32-characters-long";
process.env.OAUTH_GITHUB_CLIENT_ID ??= "test-github-client-id";
process.env.OAUTH_GITHUB_CLIENT_SECRET ??= "test-github-client-secret";
process.env.OAUTH_GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.OAUTH_GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
process.env.OAUTH_ALLOWED_REDIRECT_ORIGINS ??= "http://localhost:3000";
process.env.OAUTH_ALLOWED_REDIRECT_URIS ??=
  "http://localhost:3000/auth/callback";
process.env.GITHUB_APP_SLUG ??= "lcsp-app-test";
process.env.GITHUB_APP_ID ??= "123456";
process.env.GITHUB_APP_PRIVATE_KEY ??= "test-only-private-key";
process.env.GITHUB_APP_ALLOWED_REDIRECT_URIS ??=
  "http://localhost:3000/api/github/app/callback";
process.env.GITHUB_APP_CLIENT_ID ??= "test-github-app-client-id";
process.env.GITHUB_APP_CLIENT_SECRET ??= "test-github-app-client-secret";
process.env.MFA_SECRET_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.PYTHON_WORKER_BASE_URL ??= "http://localhost:8000";
process.env.WORKER_API_KEY ??= "test-only-worker-api-key-at-least-32-chars";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public";
