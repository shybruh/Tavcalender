FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV HOST=0.0.0.0
EXPOSE 8091
CMD ["node", "server.js"]
