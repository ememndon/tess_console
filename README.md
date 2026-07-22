# Tess Console

**A self-hosted operations platform where an AI agent (Tess) runs marketing, content, SEO,
support, and site-health for a small portfolio of live production websites, all under
role-based human oversight.**

Built solo, from empty repo to production, in TypeScript/Next.js on a self-managed VPS.

> 📌 **This is a public portfolio snapshot for you to review.**
> Infrastructure runbooks, internal docs, and all secrets and credentials are excluded.
> This repo is source for review, not a turnkey deploy.

---

## What it is

Tess Console runs three live websites through a single admin console:
[calculatry.com](https://calculatry.com) (finance calculators),
[globalresumehub.com](https://globalresumehub.com) (resume tooling), and
checkinvestng.com (investment info). An AI agent ("Tess", powered by Claude, with
OpenAI/DeepSeek/Gemini/Qwen as pluggable alternatives) reads inbox mail, drafts and publishes
social posts, writes SEO content, watches uptime and rates, and proposes or executes a
whitelisted set of server actions. Every one of those actions stays inside permission
boundaries that a human admin controls.

It's the kind of system that's easy to demo and hard to build correctly: real inboxes, real
money-adjacent copy, real infra, and an LLM in the loop that must never be given more trust
than the human explicitly grants it.

## Demo video

<a href="https://ememndon.com/videos/tess_console.mp4">
  <img src=".github/assets/video-poster.png" alt="Tess Console quick tour, click to play" width="100%">
</a>

<video src="https://ememndon.com/videos/tess_console.mp4" poster=".github/assets/video-poster.png" controls width="100%"></video>

*(Click the image above to watch. The embedded player may not autoplay everywhere, but the
link always works.)*

## Screenshots

> Captured from a throwaway instance seeded with synthetic data, not the live production
> console.

**Site Overview:** all three properties at a glance, KPI tiles, pending approvals queue

![Site Overview](.github/assets/screenshot-overview.png)

**Analytics:** first-party, cookieless traffic with a live real-time feed

![Analytics](.github/assets/screenshot-analytics.png)

**Social Studio:** the post queue across brands, autonomous vs. manual-handoff platforms

![Social Studio](.github/assets/screenshot-social-studio.png)

**Tess (Agent):** the agent's command center, with kill switch, per-module pause, budget
meter, and approval queue

![Tess Agent](.github/assets/screenshot-agent.png)

## Feature surface

**Autonomous agent**
- Chat-driven agent with 45+ callable tools (mailbox control, publishing, secrets testing,
  server actions, notifications) gated by an explicit per-tool permission model
- A deterministic "keep running" layer (cron) so heartbeats, backups, and publishing never
  depend on the LLM being available or well-behaved
- Kill switch plus per-task model routing (assign cheap/fast vs. frontier models per job type)

**Content, SEO & social**
- AI-drafted blog/SEO content with a content-strategy planner and Google Search Console
  feedback loop
- Social Studio: hook-led, platform-native post drafts (X/Facebook/Instagram/LinkedIn/
  YouTube) generated from a per-site "strategy brain," with a caption studio and Instagram
  carousel generator
- Manual-approval posting workflow, so nothing goes out without a human clicking publish
- YouTube Pack: SEO titles/descriptions plus AI-composited thumbnails, planner-scored against
  a CTR heuristic before you pick one
- Satori-rendered OG/social banners and Remotion-rendered demo/intro videos, generated
  on-brand per site (no generic templates)

**Unified inbox & outreach**
- Multi-mailbox IMAP/SMTP inbox with AI-drafted reply suggestions (never auto-sent),
  per-mailbox auto-reply mute, and spam/trash isolation from the action pipeline
- Cold outreach drafting with per-contact research

**Site health & analytics**
- Uptime, DNS, and exchange-rate watchdogs with root-cause diagnosis (not just "it's down")
- Self-hosted analytics with offline GeoIP (no third-party tracking dependency)
- Competitor content polling

**Admin & security**
- 3-tier RBAC (Admin / Manager / User) enforced at both the page and API layer
- Encrypted secrets vault (AES, server-only decrypt) with live "test connection" probes per
  provider. Raw values are never exposed to the client or to logs
- Full audit log of agent and admin actions
- Automated security posture checks (firewall, fail2ban, SSH hardening, pending updates)
  surfaced to the admin, with Tess intentionally denied root

**Demo Studio**
- Scripted, narrated product-tour video generator (Playwright capture + TTS + ffmpeg
  compose) used to produce outreach and showcase material without manual screen recording

## Architecture

```mermaid
flowchart LR
    subgraph Edge
        Caddy["Caddy (TLS, reverse proxy)"]
    end

    subgraph Core["Tess Console (Next.js app)"]
        App["App server<br/>RBAC · Agent · Vault · API"]
        DB[(PostgreSQL 16)]
    end

    subgraph Workers["Isolated worker services"]
        Media["media-worker<br/>Playwright · Piper TTS · ffmpeg"]
        Thumb["thumb-worker<br/>Fabric.js thumbnail compose"]
        Face["face-worker<br/>GFPGAN face restoration"]
        Matte["matte-worker<br/>rembg background removal"]
    end

    Browser["Admin browser"] -->|HTTPS| Caddy --> App
    App <--> DB
    App -->|internal, key-guarded| Media
    App -->|internal, key-guarded| Thumb
    App -->|internal, key-guarded| Face
    App -->|internal, key-guarded| Matte
    App -->|IMAP/SMTP| Mail[(Mailboxes)]
    App -->|pluggable| LLM["LLM providers<br/>Claude / OpenAI / DeepSeek / Gemini / Qwen"]
    Cron["Deterministic cron layer"] -.->|independent of agent| App
```

Each generation-heavy capability (video render, face restoration, background matting,
thumbnail compositing) is split into its own containerized worker so a slow render can never
block the request path of the main app. Everything talks over an internal Docker network,
authenticated with a shared internal key. None of it is reachable from the internet directly.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) |
| Database | PostgreSQL 16 + Drizzle ORM |
| UI | Tailwind CSS + shadcn/ui + Base UI |
| Auth | Argon2 password hashing, session-based, 3-tier RBAC |
| Agent / LLM | Anthropic SDK (Claude), pluggable OpenAI/DeepSeek/Gemini/Qwen |
| Mail | imapflow + mailparser + nodemailer |
| Image/graphics | Satori (banners), Sharp, Fabric.js (thumb-worker) |
| Video | Remotion, Playwright, ffmpeg, Piper TTS |
| ML workers | GFPGAN (face-worker), rembg (matte-worker) |
| Infra | Docker Compose, Caddy (reverse proxy + auto-TLS) |

## Project structure

```
app/                  Next.js application (the console itself)
  src/app/(console)/  Page routes: agent, inbox, social, seo, analytics,
                       site-health, competitors, outreach, demo-studio, settings, ...
  src/app/api/         31 route handlers (REST + internal worker callbacks)
  src/lib/             agent tools, RBAC, secrets vault, db schema (Drizzle), design engine
  drizzle/             SQL migrations
media-worker/          Demo/showcase video render pipeline (Playwright + Remotion + ffmpeg)
thumb-worker/          YouTube thumbnail compositor (Fabric.js / node-canvas)
face-worker/           Face-restoration service (GFPGAN)
matte-worker/          Background-removal service (rembg)
compose-runner/        GPU-side render orchestration for long-form showcase video
scripts/               Deterministic ops: backups, health checks, publishing, security audit
docker-compose.yml     Full service topology
```

## Running it

This snapshot excludes secrets, TLS config, and infra runbooks, so it will not deploy as is.
The shape is:

```bash
cp app/.env.example app/.env   # not in this snapshot. See docker-compose.yml
                                # for the required variables (DATABASE_URL, VAULT_MASTER_KEY,
                                # SESSION_SECRET, INTERNAL_SYNC_KEY, ...)
docker compose up -d           # starts db, app, and all worker services
docker compose logs -f app
```

Secrets for third-party integrations (LLM providers, mail, analytics) are entered at runtime
through the in-app Secrets Vault. Nothing is hardcoded or required at build time beyond the
core platform variables above.

## License

Proprietary. All rights reserved. Shared publicly for review purposes (portfolio, hiring,
technical due diligence). Not licensed for reuse, redistribution, or deployment. See
[LICENSE](LICENSE).
