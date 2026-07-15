# Tess Console

Self-hosted multi-site operations platform for calculatry.com, globalresumehub.com,
and checkinvestng.com, operated by the Tess AI agent within defined permissions.

> This is a public portfolio snapshot of the codebase for review purposes. Deployment
> configuration, infrastructure runbooks, internal docs, and all secrets/credentials have
> been excluded — this repo will not deploy on its own.

## Stack

Next.js (TypeScript) · PostgreSQL 16 · Tailwind + shadcn/ui · Docker Compose · Caddy

## Operations

```bash
docker compose up -d      # start everything
docker compose ps         # status
docker compose logs -f    # follow logs
docker compose down       # stop (data persists in named volumes)
```

Secrets live in `.env` (never committed). Database listens on loopback only.
