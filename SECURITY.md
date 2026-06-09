# Security Policy

SoftwareOntology is a data platform with access-control and governance features, so we take security seriously and try to be honest about its current limitations.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Instead email the maintainer with details and reproduction steps, and allow a reasonable window for a fix before public disclosure.

## Deploying safely

Before exposing any deployment beyond localhost:

- **Set a strong `ADMIN_PASSWORD`.** The default (`admin`) is for local use only; the server logs a `[SECURITY]` warning when it's in use.
- **Set `COOKIE_SECURE=true`** and serve behind **TLS** — the session cookie is `httpOnly` + `sameSite=lax` and is marked `Secure` when this flag is on.
- **Keep `OIDC_AUTO_PROVISION=false`** unless you intend any identity from your IdP to get an account. SSO is **experimental** (see below).
- Put the app behind a reverse proxy that adds TLS, security headers, and request limits.
- Use distinct, non-default credentials for Postgres and the S3/MinIO object store.

## What is enforced today

- **Authentication:** scrypt password hashing with timing-safe comparison; 32-byte random opaque session tokens; `httpOnly` cookies with 7-day expiry.
- **Authorization:** every mutating route is guarded by `requirePermission`; project-scoped routes additionally enforce **project membership** (`requireProjectMembership`) so a user cannot reach another project's resources via the `X-Project` header.
- **Mandatory access control:** dataset **markings** require role-based clearance (not bypassed by the `*` admin) and **propagate** to derived datasets. Clearance + property masking are enforced in the shared `resolveObjects` path, so Dashboards and AIP cannot bypass them.
- **Tenancy:** all data is `org_id`-scoped; SQL on user input is parameterized; migrations are idempotent and concurrency-safe.
- No secrets are committed (`.env` is git-ignored; only `.env.example` ships).

## Known limitations (hardening backlog)

These are documented, not hidden. Contributions welcome.

- **SSO/OIDC is experimental.** The flow does not yet validate the OIDC `state`/`nonce` (login-CSRF protection) or verify the ID-token signature. Keep SSO disabled, or behind a trusted IdP + reverse proxy, until this is hardened. Auto-provisioning of new users is **off by default** (`OIDC_AUTO_PROVISION`).
- **No built-in login rate-limiting.** Put the app behind a proxy/WAF that throttles `/api/auth/login` to mitigate credential stuffing.
- **Computed-function expressions** (`ontology:edit`) run inside the DuckDB resolve session. A denylist blocks subqueries/external reads/comments, but `ontology:edit` should still be treated as a **trusted, powerful role**. A full allowlist-AST parser is on the backlog.
- **Deployment hardening** — CORS and security-header middleware (e.g. helmet) are expected to be provided by your reverse proxy; the app assumes same-origin SPA serving.
- **Connection-string / S3-credential interpolation** into the DuckDB session uses server-controlled config only; treat those env values as trusted.

## Supported versions

This is pre-1.0 software; security fixes land on `main`. Pin a commit for production and watch the repository for updates.
