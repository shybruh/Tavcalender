# Build context: the repo root (see docker-compose.yml).

# 1. build the website
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# vite writes the build to ../backend/pb_public
RUN npm run build

# 2. PocketBase + server logic + the built website
FROM alpine:3.20
ARG PB_VERSION=0.40.5
# picks the right binary for x86 or ARM VPSes
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget tzdata \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH:-amd64}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb && rm /tmp/pb.zip

COPY backend/pb_migrations /pb/pb_migrations
COPY backend/pb_hooks /pb/pb_hooks
COPY --from=web /src/backend/pb_public /pb/pb_public

EXPOSE 8090
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", \
     "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations", "--publicDir=/pb/pb_public"]
