FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk update && apk upgrade --no-cache && npm install -g npm@latest
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY server.cjs ./
EXPOSE 8080
CMD ["node", "server.cjs"]
