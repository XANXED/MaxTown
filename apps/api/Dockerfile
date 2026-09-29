FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY design ./design
COPY tsconfig.base.json ./tsconfig.base.json
RUN npm ci --workspace=@maxtown/miniapp --workspace=@maxtown/admin --workspace=@maxtown/shared --include-workspace-root=false
# Ключ карты 2ГИС встраивается в сборку мини-аппа (он и так виден клиенту).
# Render передаёт переменные окружения сервиса в сборку как build-аргументы.
ARG VITE_DGIS_API_KEY
# Префикс прокси карты на своём домене (/dgis в Caddyfile); пусто — карта ходит в 2ГИС напрямую.
ARG VITE_DGIS_MAP_PROXY
RUN npm run build --workspace=@maxtown/miniapp && npm run build --workspace=@maxtown/admin

FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev --workspace=@maxtown/api --workspace=@maxtown/shared --include-workspace-root=false

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/russian-trusted-root-ca.pem
WORKDIR /app
COPY deploy/certs/russian-trusted-root-ca.pem /etc/ssl/certs/russian-trusted-root-ca.pem
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=dependencies /app/apps/api/package.json ./apps/api/package.json
COPY --from=dependencies /app/apps/api/src ./apps/api/src
COPY --from=dependencies /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=dependencies /app/packages/shared/src ./packages/shared/src
COPY --from=build --chown=node:node /app/apps/miniapp/dist ./apps/miniapp/dist
COPY --from=build --chown=node:node /app/apps/admin/dist ./apps/admin/dist

USER node
EXPOSE 3000
CMD ["npm", "run", "start:container", "--workspace=@maxtown/api"]
