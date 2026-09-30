# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /app
COPY .npmrc bun.lock package.json ./
RUN bun install --frozen-lockfile
COPY . .
# Builds need no production database or credentials.
RUN DATABASE_URL=file:/tmp/facmandu-build.db bun run build

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production BODY_SIZE_LIMIT=101M
COPY .npmrc bun.lock package.json ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["bun", "run", "start"]
