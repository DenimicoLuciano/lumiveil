# ---- build stage: install deps (native modules may need build tools) ----
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ---- runtime stage ----
FROM node:20-bookworm-slim
# ca-certificates: the libsql client needs system root CAs to reach Turso over TLS
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js db.js characters.js ./
COPY public ./public
# DATA_DIR only matters for the local-file DB fallback; production data
# lives in Turso (see render.yaml). Render's free plan disk is ephemeral.
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3000
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
