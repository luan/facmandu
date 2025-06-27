# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Factorio Manager is a SvelteKit web application for managing Factorio mod lists with integration to the official Factorio mod portal API. Users can create, organize, and share mod collections with real-time collaboration features.

## Technology Stack

- **Runtime**: Bun (package manager and JavaScript runtime)
- **Framework**: SvelteKit 5.0 with TypeScript
- **Database**: SQLite with Drizzle ORM (Turso for production)
- **Styling**: TailwindCSS 4.0 with custom UI components built on bits-ui
- **Authentication**: Custom session-based auth with Argon2 password hashing

## Essential Commands

```bash
# Development
bun install              # Install dependencies
bun run dev             # Start development server (http://localhost:5173)

# Database
bun run db:generate     # Generate database migrations
bun run db:push         # Apply schema changes to database
bun run db:studio       # Open Drizzle Studio (database GUI)

# Code Quality
bun run lint            # Run ESLint
bun run format          # Format code with Prettier
bun run check           # Run SvelteKit type checking

# Production
bun run build           # Build for production
bun run start           # Start production server
```

## Project Architecture

### Database Schema

The core entities are defined in `src/lib/server/db/schema.ts`:

- **users**: Authentication with Factorio credentials integration
- **sessions**: Session-based authentication
- **modLists**: User-owned mod collections with visibility controls
- **modListCollaborators**: Shared access management
- **mods**: Cached mod metadata from Factorio portal API

### Key Directories

- `src/routes/(app)/`: Authenticated application pages with route groups
- `src/routes/(auth)/`: Authentication flow (login, register)
- `src/routes/api/`: Server-side API endpoints
- `src/lib/components/ui/`: Comprehensive reusable UI component library
- `src/lib/server/db/`: Database schema and query utilities
- `src/lib/server/services/`: Business logic services
- `src/lib/stores/`: Svelte stores for client-side state management

### API Integration

The app integrates with the Factorio mod portal API to fetch mod information. Mod data is cached locally in the database with rich metadata including titles, descriptions, thumbnails, and download statistics.

## Development Patterns

### Database Operations

- Use Drizzle ORM with type-safe queries
- Database connections are managed in `src/lib/server/db/index.ts`
- All database operations should be performed server-side

### Authentication

- Session-based authentication implemented in `src/lib/server/auth.ts`
- User sessions are validated via `src/hooks.server.ts`
- Protected routes use the `(app)` route group layout

### UI Components

- Custom component library built on bits-ui primitives
- Components follow consistent naming: Button, Dialog, DataTable, etc.
- Tailwind variants used for component styling variations
- Dark/light mode theming supported throughout

### State Management

- Server state managed via SvelteKit's built-in stores and page data
- Client-side reactive state uses Svelte stores in `src/lib/stores/`
- Real-time features implemented via stores with periodic updates

## Configuration

### Environment Setup

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL`: SQLite database path or Turso connection string
- `DATABASE_AUTH_TOKEN`: Required for Turso production database

### Code Style

- **Prettier**: Tabs, single quotes, 100 character line width
- **ESLint**: TypeScript and Svelte rules enabled
- **TypeScript**: Strict mode with path mapping configured

## Testing and Deployment

### Local Development

- Uses SQLite database stored in `local.db`
- Hot module replacement via Vite
- Type checking integrated with SvelteKit

### Production Deployment

- Docker support with multi-stage build
- Fly.io deployment configuration included
- Supports Turso for production database scaling
- Build artifacts optimized via SvelteKit adapter-node
