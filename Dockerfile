FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:18-alpine
RUN apk add --no-cache icu-libs
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 8110
ENV NODE_ENV=production
ENV TRANSPORT=http
CMD ["node", "dist/atlisp-mcp.js"]
