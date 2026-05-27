---
title: Cloudflare Pages and Oracle Typesense
description: Free hosting path for the docs site with Cloudflare Pages and a self-hosted Typesense node on Oracle Cloud Always Free.
---

# Cloudflare Pages and Oracle Typesense

This guide documents the free hosted docs path for OpenKeep:

- Cloudflare Pages serves the static Docusaurus site
- an Oracle Cloud Always Free VM runs Typesense
- the Cloudflare GitHub App builds and deploys the docs site natively from GitHub
- GitHub Actions reindexes search after production docs changes land on `main`

This matches the current docs app in `apps/docs`, which is a static Docusaurus build with optional Typesense-backed search.

## Architecture

1. Cloudflare Pages builds `apps/docs` directly from GitHub.
2. Cloudflare Pages injects the browser-facing Typesense configuration into the Docusaurus build.
3. Cloudflare deploys the docs site to the configured production domain.
4. GitHub Actions waits for the public docs URL to become reachable after changes land on `main`.
5. GitHub Actions scrapes the deployed docs site and refreshes the Typesense collection.

## Prerequisites

- a Cloudflare account
- an Oracle Cloud account with an Always Free VM
- a Cloudflare Pages project
- a public DNS name for the docs site such as `docs.example.com`
- a public DNS name for Typesense such as `typesense-docs.example.com`

## Oracle VM Setup

Recommended shape:

- Ubuntu 24.04 ARM instance
- at least one persistent block volume or durable boot disk space for `/data`
- inbound `80` and `443` open
- a strong random `TYPESENSE_API_KEY`

Install Docker on the VM, then create `/opt/openkeep-typesense/docker-compose.yml`:

```yaml
services:
  typesense:
    image: typesense/typesense:27.1
    restart: unless-stopped
    command: --data-dir /data --api-key=${TYPESENSE_API_KEY} --enable-cors
    volumes:
      - ./data:/data
    expose:
      - "8108"

  caddy:
    image: caddy:2.8
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - typesense

volumes:
  caddy_data:
  caddy_config:
```

Create `/opt/openkeep-typesense/Caddyfile`:

```text
typesense-docs.example.com {
  reverse_proxy typesense:8108
}
```

Create `/opt/openkeep-typesense/.env`:

```text
TYPESENSE_API_KEY=replace-with-a-long-random-admin-key
```

Start the services:

```bash
docker compose up -d
```

Verify from your machine:

```bash
curl https://typesense-docs.example.com/health
```

Expected result:

```json
{"ok":true}
```

## Cloudflare Pages Setup

Install the Cloudflare GitHub App on this repository only, then configure the Pages project to use native GitHub builds.

Recommended Pages build settings:

- Framework preset: `None`
- Root directory: `/`
- Build command: `pnpm install --frozen-lockfile && pnpm docs:build`
- Build output directory: `apps/docs/build`

Set the production domain to the same value you will store in `DOCS_SITE_URL`, for example:

- `https://docs.example.com`

Add these Cloudflare Pages environment variables for both Production and Preview as needed:

- `DOCS_SITE_URL`: production or preview docs URL
- `TYPESENSE_COLLECTION_NAME`: collection alias, usually `openkeep-docs`
- `TYPESENSE_HOST`: public Typesense host without protocol, for example `typesense-docs.example.com`
- `TYPESENSE_PORT`: public Typesense port, usually `443`
- `TYPESENSE_PROTOCOL`: public Typesense protocol, usually `https`
- `TYPESENSE_SEARCH_API_KEY`: a search-only key for the docs collection

`TYPESENSE_SEARCH_API_KEY` must be a search-only key, not the admin key. The Docusaurus build embeds it into the client-side search config.

Generate or rotate that key from a machine that can reach Typesense:

```bash
export TYPESENSE_HOST=typesense-docs.example.com
export TYPESENSE_PORT=443
export TYPESENSE_PROTOCOL=https
export TYPESENSE_ADMIN_API_KEY=replace-with-admin-key
export TYPESENSE_COLLECTION_NAME=openkeep-docs
export TYPESENSE_SEARCH_API_KEY_FILE=/tmp/openkeep-docs-search-key
node scripts/docs/bootstrap-typesense-search-key.mjs
```

Then read the generated value and paste it into the Cloudflare Pages environment variable:

```bash
tr -d '\n' < /tmp/openkeep-docs-search-key
```

## GitHub Repository Configuration

Add these GitHub Actions secrets:

- `TYPESENSE_ADMIN_API_KEY`: the Oracle-hosted Typesense admin key

Add these GitHub Actions variables:

- `DOCS_SITE_URL`: public docs URL, for example `https://docs.example.com`
- `TYPESENSE_COLLECTION_NAME`: collection alias, usually `openkeep-docs`
- `TYPESENSE_HOST`: public Typesense host without protocol, for example `typesense-docs.example.com`
- `TYPESENSE_PORT`: public Typesense port, usually `443`
- `TYPESENSE_PROTOCOL`: public Typesense protocol, usually `https`

These values are consumed by `.github/workflows/reindex-docs-search.yml`.

## Deployment Flow

Push to `main` or run the workflow manually.

Cloudflare Pages will:

- build the docs with the browser-facing Typesense config from Pages environment variables
- deploy the static site from `apps/docs/build`

GitHub Actions will:

- install dependencies
- wait for the production docs site to become reachable
- reindex the deployed site with `pnpm docs:search:index:remote`

## Local Dry Run

You can test the remote indexing path before relying on CI:

```bash
export TYPESENSE_PUBLIC_HOST=typesense-docs.example.com
export TYPESENSE_PUBLIC_PORT=443
export TYPESENSE_PUBLIC_PROTOCOL=https
export TYPESENSE_ADMIN_API_KEY=replace-with-admin-key
export TYPESENSE_COLLECTION_NAME=openkeep-docs
export DOCSEARCH_START_URL=https://docs.example.com
export DOCSEARCH_SITEMAP_URL=https://docs.example.com/sitemap.xml
export DOCSEARCH_STOP_URL=https://docs.example.com/search
pnpm docs:search:index:remote
```

## Operational Notes

- the docs build embeds a search-only key, not the admin key
- the search-only key now lives in Cloudflare Pages environment variables
- if you rotate the search-only key, update the Pages environment variable before the next build
- the Typesense admin API is reachable from GitHub Actions, so use TLS and a strong admin key
- the reindex workflow waits for the deployed sitemap before scraping to reduce stale-search races
- repeated indexing clears the active alias first and removes stale collections after a successful scrape

## Troubleshooting

If the docs deploy succeeds but search is missing:

- confirm `DOCS_SITE_URL` matches the live Pages domain
- confirm `TYPESENSE_HOST`, `TYPESENSE_PORT`, and `TYPESENSE_PROTOCOL` point to the public Oracle endpoint
- confirm `TYPESENSE_SEARCH_API_KEY` is set in Cloudflare Pages and is a search-only key
- confirm the workflow can reach `https://<typesense-host>/health`
- confirm the workflow can reach `${DOCS_SITE_URL}/sitemap.xml`
- confirm CORS is enabled on the Typesense node

If indexing fails:

- confirm Docker is available in the GitHub-hosted runner logs
- confirm the admin key is correct
- confirm the docs site is publicly reachable before the scrape step begins
