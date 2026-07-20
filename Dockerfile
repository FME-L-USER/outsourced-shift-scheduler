FROM node:20-alpine AS builder
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm uninstall -g npm corepack
COPY --from=builder /app/dist ./dist
COPY server.cjs ./
EXPOSE 8080
CMD ["node", "server.cjs"]
