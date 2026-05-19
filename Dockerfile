# syntax=docker/dockerfile:1
# Imagem base com Chromium + libs do Puppeteer pré-instalados.
# Mantemos a versão alinhada com puppeteer do package.json.
FROM ghcr.io/puppeteer/puppeteer:24.42.0

# A imagem base define PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer
# e já vem com o Chromium baixado lá. NÃO sobrescrever PUPPETEER_EXECUTABLE_PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    SERVER_PORT=8080

WORKDIR /app

COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=pptruser:pptruser . .

EXPOSE 8080

CMD ["node", "server.js"]
