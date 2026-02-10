FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Run migrations on start, then launch server
EXPOSE 3000

CMD ["sh", "-c", "bun run src/db/migrate.ts && bun run src/index.ts"]
