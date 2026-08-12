import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const required = [
  'E2E_DATABASE_URL',
  'E2E_DATABASE_MIGRATION_URL',
  'E2E_DATABASE_EXPECTED_NAME',
  'E2E_DATABASE_FINGERPRINT',
  'E2E_DATABASE_EXPECTED_RUNTIME_ROLE',
  'E2E_DATABASE_EXPECTED_MIGRATION_ROLE',
  'E2E_SESSION_SECRET',
]

if (required.some((name) => !process.env[name])) {
  throw new Error('E2E database environment is incomplete. Pull the Development E2E_ variables first.')
}

Object.assign(process.env, {
  DATABASE_URL: process.env.E2E_DATABASE_URL,
  DATABASE_MIGRATION_URL: process.env.E2E_DATABASE_MIGRATION_URL,
  DATABASE_EXPECTED_NAME: process.env.E2E_DATABASE_EXPECTED_NAME,
  DATABASE_FINGERPRINT: process.env.E2E_DATABASE_FINGERPRINT,
  DATABASE_EXPECTED_RUNTIME_ROLE: process.env.E2E_DATABASE_EXPECTED_RUNTIME_ROLE,
  DATABASE_EXPECTED_MIGRATION_ROLE: process.env.E2E_DATABASE_EXPECTED_MIGRATION_ROLE,
  APP_ENVIRONMENT: process.env.E2E_APP_ENVIRONMENT ?? 'development',
  SESSION_SECRET: process.env.E2E_SESSION_SECRET,
  // Give the local Next server and browser tests the same ephemeral secret so
  // the protected scheduler endpoint is exercised without storing a test secret.
  CRON_SECRET: randomBytes(32).toString('base64url'),
})

for (const [command, args] of [
  [process.execPath, ['scripts/migrate.mjs']],
  [process.execPath, ['scripts/verify-db.mjs']],
  [
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      ...process.argv.slice(2),
    ],
  ],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
