FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev --workspace=@maxtown/api --workspace=@maxtown/shared --include-workspace-root=false

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=dependencies /app/apps/api/package.json ./apps/api/package.json
COPY --from=dependencies /app/apps/api/src ./apps/api/src
COPY --from=dependencies /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=dependencies /app/packages/shared/src ./packages/shared/src

USER node
EXPOSE 3000
CMD ["npm", "run", "start:container", "--workspace=@maxtown/api"]
