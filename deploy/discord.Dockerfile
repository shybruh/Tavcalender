FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV HOST=0.0.0.0
EXPOSE 8092
CMD ["node", "src/index.js"]
