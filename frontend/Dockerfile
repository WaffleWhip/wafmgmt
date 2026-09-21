FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install
COPY frontend/ .
RUN bun run build

FROM oven/bun:1-alpine AS runner
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
ENV HOST=0.0.0.0 PORT=3001 NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "build/index.js"]
