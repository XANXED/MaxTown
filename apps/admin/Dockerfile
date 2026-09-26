FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY design ./design
COPY tsconfig.base.json ./tsconfig.base.json
RUN npm ci --workspace=@maxtown/admin --workspace=@maxtown/shared --include-workspace-root=false
RUN npm run build --workspace=@maxtown/admin

FROM nginx:1.29-alpine
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
