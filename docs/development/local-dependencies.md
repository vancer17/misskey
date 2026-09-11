# Local dependency deployment

This repository can run PostgreSQL and Redis as local development dependencies while Misskey itself still runs on the host with `pnpm dev`.

## Start

```bash
pnpm install --frozen-lockfile
pnpm dev:deps
```

The first run creates `.config/docker.env` from `.config/docker_example.env`. The file is ignored by Git and can be customized without committing local credentials.

If ports `5432` or `6379` are already used, change `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` in `.config/docker.env`. Then use the same port as the `db.port` / `redis.port` value in `.config/default.yml`.

## Configure and run Misskey

For a first local setup, copy the local Misskey template and run migrations:

```bash
cp .config/local_example.yml .config/default.yml
pnpm migrate
pnpm dev
```

Open `http://localhost:3000`. The local template uses the same PostgreSQL credentials as `.config/docker_example.env`.

FFmpeg must be installed on the host because the Misskey application process, not these dependency containers, performs media processing.

## Optional search dependency

Meilisearch is not required for normal local development. To start it as well:

```bash
pnpm dev:deps:search
```

It listens on the port configured by `MEILISEARCH_HOST_PORT` (default `7700`) and persists data in the Compose volume `misskey-local-deps_meilisearch_data`.

## Lifecycle

```bash
pnpm dev:deps:status
pnpm dev:deps:logs
pnpm dev:deps:down
pnpm dev:deps:restart
```

`down` preserves PostgreSQL, Redis, and Meilisearch volumes. To destroy all dependency data after confirming that it is no longer needed:

```bash
pnpm dev:deps:reset --confirm
```
