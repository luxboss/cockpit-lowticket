# Minerador v2 (SPEC-008/009): build do web (estagio 1) + runtime enxuto com a API, o worker e web/dist (estagio 2).
# O app v1 (server.js e index.html na raiz) fica no repositorio mas nao e mais usado; para voltar a ele, ver o checklist do REL-001
# (Implantar de novo a partir da tag esteira-completa ou do commit anterior da main).

# ---- estagio 1: instala e builda web/ (React + Vite)
FROM node:20-alpine AS web
WORKDIR /build/web
# dependencias primeiro (cache de camada)
COPY web/package.json web/package-lock.json ./
RUN npm ci
# fontes do web (o .dockerignore ja deixa de fora node_modules e dist locais; o rm abaixo e cinto e suspensorio)
COPY web/ /tmp/websrc/
RUN cd /tmp/websrc && rm -rf node_modules dist && cp -a . /build/web/ && rm -rf /tmp/websrc
RUN npm run build

# ---- estagio 2: runtime (dependencias de producao da raiz, server/ e web/dist)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY server/ ./server/
COPY --from=web /build/web/dist ./web/dist

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-80}/healthz || exit 1

# um container, dois processos: server/index.js serve a API e o web/dist e faz fork de server/worker.js
CMD ["node", "server/index.js"]
