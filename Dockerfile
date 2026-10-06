FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80

# Dependencias primeiro (cache de camada). Usa lockfile se existir.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Somente o necessario (ver .dockerignore)
COPY . .

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

CMD ["node", "server.js"]
