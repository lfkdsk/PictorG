# 使用官方 Node.js 运行时作为父镜像
FROM node:20-alpine AS base

# 安装依赖项所需的包
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 安装依赖项
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# 构建阶段
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# 构建应用程序
RUN npm run build

# 生产阶段
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
# 禁用遥测
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# 设置正确的权限
RUN mkdir .next
RUN chown nextjs:nodejs .next

# 自动利用输出跟踪来减少镜像大小
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# 启动应用程序
CMD ["node", "server.js"]