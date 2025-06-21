# syntax = docker/dockerfile:1

# Adjust BUN_VERSION as desired
ARG BUN_VERSION=1.2.14
FROM oven/bun:${BUN_VERSION}-slim AS base

ARG TURSO_CONNECTION_URL
ARG TURSO_AUTH_TOKEN

LABEL fly_launch_runtime="Bun"

# SvelteKit app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

# Install node modules
COPY .npmrc bun.lock package-lock.json package.json ./
RUN bun install

# Copy application code
COPY . .

# Build application
RUN TURSO_CONNECTION_URL=$TURSO_CONNECTION_URL TURSO_AUTH_TOKEN=$TURSO_AUTH_TOKEN bun run build

# Remove development dependencies
RUN rm -rf node_modules && bun install --ci

# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app/build /app/build
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "bun", "run", "start" ]
