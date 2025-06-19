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
2. Install dependencies: `npm install`
3. Set up your database URL in `.env`
4. Push database schema: `npm run db:push`
5. Configure your Factorio credentials in the settings page

## Developing

Start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Database

The application uses Drizzle ORM with SQLite. Run database commands:

```bash
# Push schema changes
npm run db:push

# Generate migrations
npm run db:migrate

# Open database studio
npm run db:studio
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
