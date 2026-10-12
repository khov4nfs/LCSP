#!/usr/bin/env bash
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

jest_config='./jest.config.ts'
if [[ "${1:-}" == '--e2e' ]]; then
  jest_config='./test/jest-e2e.ts'
  shift
fi

postgres_port="${LCSP_TEST_PG_PORT:-55441}"
if [[ ! "$postgres_port" =~ ^[0-9]+$ ]] || (( postgres_port < 1 || postgres_port > 65535 )); then
  echo "Invalid disposable PostgreSQL port" >&2
  exit 2
fi
run_id="$(date -u +%Y%m%d_%H%M%S)_$$"
schema_database="lcsp_api_assessment_schema_$run_id"
integration_database="lcsp_api_assessment_jest_$run_id"
schema_database_url="postgresql://postgres:postgres@127.0.0.1:$postgres_port/$schema_database?schema=public"
integration_database_url="postgresql://postgres:postgres@127.0.0.1:$postgres_port/$integration_database?schema=public"
run_dir="$repo_root/reports/api-regression/$run_id"
mkdir -p "$run_dir" || exit 1

run_checks() {
  pnpm run build:runtime-packages || return
  # Schema-reset suites must not erase migration-only guards used by integration suites.
  API_TEST_POSTGRES_PORT="$postgres_port" API_TEST_SCHEMA_DATABASE="$schema_database" API_TEST_INTEGRATION_DATABASE="$integration_database" node <<'NODE' || return
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { Client } = createRequire(resolve("apps/api/package.json"))("pg");
(async () => {
  const client = new Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.API_TEST_POSTGRES_PORT}/postgres` });
  await client.connect();
  try {
    for (const name of [process.env.API_TEST_SCHEMA_DATABASE, process.env.API_TEST_INTEGRATION_DATABASE]) {
      if (!/^lcsp_api_assessment_(?:schema|jest)_[0-9_]+$/.test(name)) throw new Error("Invalid disposable database name");
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`Created disposable database ${name}`);
    }
  } finally {
    await client.end();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
NODE
  if ! DATABASE_URL="$schema_database_url" pnpm --dir apps/api run prisma:migrate:deploy > "$run_dir/schema-migrations.log" 2>&1; then
    cat "$run_dir/schema-migrations.log"
    return 1
  fi
  if ! DATABASE_URL="$integration_database_url" pnpm --dir apps/api run prisma:migrate:deploy > "$run_dir/integration-migrations.log" 2>&1; then
    cat "$run_dir/integration-migrations.log"
    return 1
  fi
  printf 'Migrations complete for both disposable databases; detailed logs: %s\n' "$run_dir"
  DATABASE_URL="$schema_database_url" \
    PHASE25_DATABASE_URL="$integration_database_url" \
    NODE_OPTIONS='--max-old-space-size=1536 --experimental-vm-modules' \
    pnpm --dir apps/api exec jest --config "$jest_config" --maxWorkers=1 \
      --json --outputFile "$run_dir/api-jest-results.json" "$@"
}

run_checks "$@" 2>&1 | tee "$run_dir/run.log"
result=${PIPESTATUS[0]}
printf '\nAPI regression exit code: %s\nEvidence directory: %s\n' "$result" "$run_dir"
exit "$result"
