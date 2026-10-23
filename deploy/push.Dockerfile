# Build context: the repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY push/package.json push/package-lock.json ./
RUN npm ci --omit=dev
COPY push/server.js ./
ENV HOST=0.0.0.0
EXPOSE 8091
CMD ["node", "server.js"]
