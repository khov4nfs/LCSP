process.env.NODE_ENV = "test";
process.env.RABBITMQ_URL ??= "amqp://guest:guest@127.0.0.1:5672";
process.env.RABBITMQ_EXCHANGE ??= "lcsp.events.test";
process.env.OUTBOX_POLL_INTERVAL_MS ??= "60000";
process.env.OAUTH_GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.OAUTH_GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
process.env.OAUTH_ALLOWED_REDIRECT_ORIGINS ??= "http://localhost:3000";
process.env.MFA_SECRET_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION ??= "test-kek-v1";
process.env.GITHUB_CLI_CREDENTIAL_KEK_KEYRING ??= JSON.stringify({
  "test-kek-v1": Buffer.alloc(32, 7).toString("base64"),
});
process.env.WORKER_API_KEY ??= "test-only-worker-api-key-at-least-32-chars";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public";
process.env.BILLING_SEPAY_BANK_NAME ??= "Test Bank";
process.env.BILLING_SEPAY_BANK_ACCOUNT_NUMBER ??= "1234567890";
process.env.BILLING_SEPAY_ACCOUNT_HOLDER ??= "LCSP TEST";
process.env.BILLING_SEPAY_QR_URL_TEMPLATE ??=
  "https://payments.test/qr?amount={amountVnd}&content={paymentCode}";
