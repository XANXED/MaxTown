FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/bot/src ./apps/bot/src
RUN npm ci --omit=dev --workspace=@maxtown/bot --include-workspace-root=false

USER node
CMD ["node", "apps/bot/src/index.ts"]
