# Build context: the repo root (see docker-compose.yml).
FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY discord/package.json discord/package-lock.json ./
RUN npm ci --omit=dev
COPY discord/src ./src
ENV HOST=0.0.0.0
EXPOSE 8092
CMD ["node", "src/index.js"]
