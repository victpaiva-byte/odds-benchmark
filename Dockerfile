# syntax=docker/dockerfile:1
# Imagem base já tem Chromium + libs do Puppeteer pré-instalados.
FROM ghcr.io/puppeteer/puppeteer:24.10.1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production \
    SERVER_PORT=8080

WORKDIR /app

# Copia package* primeiro para aproveitar cache de layers
COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=pptruser:pptruser . .

EXPOSE 8080

CMD ["node", "server.js"]
