FROM node:20-alpine
WORKDIR /app

# Instala dependências de produção (pg)
COPY package*.json ./
RUN npm install --omit=dev

# Copia arquivos do aplicativo
COPY . .

EXPOSE 80
ENV PORT=80

CMD ["node", "server.js"]
