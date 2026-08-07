# syntax=docker/dockerfile:1

# ---- Build stage: 构建静态产物 ----
FROM node:22-alpine AS build
WORKDIR /app

# 启用 corepack 并锁定 pnpm 版本（与 package.json 的 packageManager 一致）
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# 前端资源 base path：子路径部署默认 /dashboard/（由 Caddy 剥离前缀后反代），
# 如需根路径部署可用 --build-arg VITE_BASE=/ 覆盖
ARG VITE_BASE=/dashboard/
ENV VITE_BASE=$VITE_BASE

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Runtime stage: nginx 托管静态文件并反向代理 /api ----
FROM nginx:1.27-alpine

# 后端 API 地址，可通过运行时 -e API_UPSTREAM=host:port 覆盖
ENV API_UPSTREAM=api:8766

# nginx 官方镜像会自动渲染 /etc/nginx/templates/*.template 到 /etc/nginx/conf.d/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
