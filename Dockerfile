FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json bunfig.toml ./
COPY packages ./packages
COPY scripts ./scripts
COPY examples ./examples
RUN bun install --frozen-lockfile
RUN bun run build:ui
RUN bun build --compile --minify --outfile /out/bakorin packages/server/src/cli.ts

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/bakorin /usr/local/bin/bakorin
COPY examples/studio-leads /project
WORKDIR /project
ENV NODE_ENV=production
ENV BAKORIN_ENV=production
ENV BAKORIN_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4371
CMD ["bakorin", "start"]
