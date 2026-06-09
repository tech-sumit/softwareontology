# Contributing to SoftwareOntology

Thanks for your interest! This document covers local setup, how the codebase is organised, and the workflow we use.

## Development setup

Requirements: **Node 20+**, **pnpm 9+**, and **Docker** (for Postgres + MinIO).

```bash
pnpm install
pnpm run infra:up        # Postgres + MinIO via docker compose
pnpm run infra:seed      # demo overlay data
pnpm run dev:api         # API + all modules on :3000
pnpm run dev:web         # Vite UI dev server
```

Run the full check the way CI does before opening a PR:

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```

All three must be green. The test suite runs per-module integration tests against the local Docker services, jsdom component tests, and a full end-to-end suite.

## Architecture in one minute

A **modular monolith**. `@so/kernel` loads **modules** (each a `defineModule({ id, dependsOn, contributes, onInstall })`) in dependency order and gives them a service container (`ctx`). A module owns its **routes**, **migrations**, and **service**. To add a capability, add a module under `packages/`, register it in `apps/web/modules.mjs`, and it's mounted at `/api/<id>`.

- Migrations use `applyMigrations(db, '<module>', [...statements])` — idempotent and concurrency-safe (advisory lock).
- Routes are guarded with `requirePermission('<perm>')`; project-scoped routes also use `requireProjectMembership()`.
- Object reads go through `ontology.resolveObjects`, which enforces governance (markings + masking) — don't reach around it.

## How we plan work

Non-trivial features follow a **spec → plan → build** flow, recorded under `docs/superpowers/`:

1. A design **spec** in `docs/superpowers/specs/`.
2. A step-by-step **plan** in `docs/superpowers/plans/` (exact files, code, tests, commands).
3. Implementation task-by-task, each ending green.

`docs/IMPLEMENTED.md` is the living catalogue of what exists; keep it reconciled when you ship a feature.

## Coding standards

- **TypeScript strict** (`verbatimModuleSyntax`, `exactOptionalPropertyTypes`). No `any` escapes; fix types properly.
- Match the surrounding code's style, naming, and idiom. Prefer small, focused files.
- Parameterize all SQL on user input. Never interpolate untrusted values into queries.
- Add tests with every change — integration tests for backend behavior, jsdom tests for pure web components.
- Do not disable lint rules to get green (e.g. no `eslint-disable react-hooks/exhaustive-deps`).

## Commits & PRs

- Use clear, conventional-ish messages: `feat(<scope>): …`, `fix(security): …`, `test(<scope>): …`, `docs: …`.
- Branch off `main`; keep PRs focused.
- A PR is mergeable only when `typecheck`, `lint`, and `test` are all green.

## Reporting bugs / security issues

Open an issue for bugs. For security vulnerabilities, follow **[SECURITY.md](./SECURITY.md)** — please don't open a public issue for those.

By contributing you agree your contributions are licensed under the project's [MIT License](./LICENSE).
