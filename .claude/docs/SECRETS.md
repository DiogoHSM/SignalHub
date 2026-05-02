# Secrets

This file documents required environment variables with safe examples only. Do not store real secrets here.

Root-level `SECRETS.md` is ignored and may be used for local private notes.

| Variable | Required | Safe example | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode. Valid values are `development`, `test`, and `production`. |
| `PORT` | No | `3000` | API listen port. |
| `DATABASE_URL` | Yes | `postgres://signalhub:example-local-password@localhost:5432/signalhub` | Postgres URL for local Node commands. |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis URL for local Node commands. |
| `POSTGRES_PASSWORD` | Yes for Compose | `example-local-password-change-me` | Compose Postgres user password. Replace before first database start. |
| `POSTGRES_PASSWORD_URLENCODED` | Sometimes | `example-local-password-change-me` | URL-encoded password for Compose internal `DATABASE_URL` when the raw password has URL-reserved characters. |
| `POSTGRES_PORT` | No | `5432` | Host port for Compose Postgres binding. |
| `REDIS_PORT` | No | `6379` | Host port for Compose Redis binding. |
| `SESSION_SECRET` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Used to sign human session cookies. |
| `API_KEY_PEPPER` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Used for ingestion API key hashing. |
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | `admin@example.com` | Email used by `pnpm seed:admin`. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Initial admin login password. |
| `GOOGLE_OAUTH_ENABLED` | No | `false` | Enables Google OAuth only when set to `true`. |
| `GOOGLE_CLIENT_ID` | If OAuth enabled | `example-client-id.apps.googleusercontent.com` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | If OAuth enabled | `example-client-secret` | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | If OAuth enabled | `http://localhost:3000/auth/google/callback` | OAuth callback URL. |

Operational rules:

- Generate new values for `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` outside disposable local use.
- Do not commit `.env`.
- Do not commit root-level `SECRETS.md`.
- API key secrets returned by `/admin/projects/:projectId/api-keys` are one-time values and should be copied directly into the target client secret store.
