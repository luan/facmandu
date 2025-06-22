# Factorio Manager

A web application for managing Factorio mod lists with integration to the Factorio mod portal API.

## Features

- **Mod List Management**: Create and manage multiple mod lists
- **Mod Portal Integration**: Search and add mods directly from the Factorio mod portal
- **Rich Mod Information**: Cached mod data including:
  - Mod title, summary, and description
  - Category and tags
  - Thumbnail images
  - Download counts
  - Version information
  - Factorio compatibility
  - Last updated timestamps
- **Auto-refresh**: Automatic background updates of mod information
- **Manual Refresh**: Refresh individual mods or entire lists on demand

## Setup

1. Clone the repository
2. Install dependencies: `bun install`
3. Configure your database in `.env`
   - **SQLite (local development)**: `DATABASE_URL="file:./db.sqlite"`
   - **Turso (production/remote)**: set `TURSO_CONNECTION_URL="libsql://<host>.turso.io"` and `TURSO_AUTH_TOKEN="<token>"`
4. Push database schema: `bun run db:push`
5. Configure your Factorio credentials in the settings page

## Developing

Start a development server:

```bash
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Database

The application uses Drizzle ORM with SQLite. Run database commands:

```bash
# Push schema changes
bun run db:push

# Generate migrations
bun run db:migrate

# Open database studio
bun run db:studio
```

## Building

To create a production version of your app:

```bash
bun run build
```

You can preview the production build with `bun run preview`.

## Deployment

This project can be deployed anywhere Bun&nbsp;apps run. Two common approaches are Docker and Fly.io.

### Docker

```bash
docker build -t factorio-manager .

# SQLite (volume mount example)
docker run -p 3000:3000 -v $(pwd)/data:/app/data \
  -e DATABASE_URL="file:/app/data/db.sqlite" factorio-manager

# Turso (libsql) example
docker run -p 3000:3000 \
  -e TURSO_CONNECTION_URL="libsql://<host>.turso.io" \
  -e TURSO_AUTH_TOKEN="<token>" factorio-manager
```

### Fly.io

```bash
# Initial setup (one-time)
fly launch --no-deploy

# Set secrets for Turso if using it
a fly secrets set TURSO_CONNECTION_URL="libsql://<host>.turso.io" TURSO_AUTH_TOKEN="<token>"

# Deploy
fly deploy
```

After deployment the application listens on port&nbsp;3000 by default.
