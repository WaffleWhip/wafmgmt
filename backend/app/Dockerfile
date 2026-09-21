FROM oven/bun:1

RUN apt-get update && apt-get install -y --no-install-recommends \
      wireguard-tools iproute2 procps openssh-client sshpass \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY backend/kernel ./backend/kernel
COPY backend/modules ./backend/modules
COPY backend/app ./backend/app
COPY backend/scripts ./backend/scripts

ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "backend/app/index.ts"]
