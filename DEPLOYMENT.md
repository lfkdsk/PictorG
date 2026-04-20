# PicG 部署指南

本文档介绍如何部署 PicG 应用到不同的平台。

## 📋 目录

- [GitHub Pages 部署](#github-pages-部署)
- [Vercel 部署](#vercel-部署)
- [Docker 部署](#docker-部署)
- [自定义服务器部署](#自定义服务器部署)
- [环境变量配置](#环境变量配置)
- [故障排除](#故障排除)

## 🚀 Vercel 部署（推荐）

### 自动部署

1. **配置 Vercel Secrets**
   ```bash
   # 在 GitHub 仓库 Secrets 中添加：
   VERCEL_TOKEN=your_vercel_token
   VERCEL_ORG_ID=your_vercel_org_id
   VERCEL_PROJECT_ID=your_vercel_project_id
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # GitHub Personal Access Token
   ```

2. **推送代码自动部署**
   ```bash
   git push origin main
   ```

### 手动部署

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录并部署
vercel login
vercel --prod
```

## ☁️ Vercel 部署

### 自动部署

1. **配置 Vercel Secrets**
   ```bash
   # 在 GitHub 仓库 Secrets 中添加：
   VERCEL_TOKEN=your_vercel_token
   VERCEL_ORG_ID=your_vercel_org_id
   VERCEL_PROJECT_ID=your_vercel_project_id
   ```

2. **推送代码自动部署**
   ```bash
   git push origin main
   ```

### 手动部署

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录并部署
vercel login
vercel --prod
```

## 🐳 Docker 部署

### 构建 Docker 镜像

```bash
# 1. 构建镜像
npm run docker:build

# 2. 运行容器
npm run docker:run

# 或者直接使用 Docker 命令
docker build -t picg .
docker run -p 3000:3000 picg
```

### 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  picg:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_BASE_PATH=
    restart: unless-stopped
```

运行：
```bash
docker-compose up -d
```

### Docker Hub 自动部署

配置 GitHub Secrets：
```bash
DOCKER_USERNAME=your_docker_username
DOCKER_PASSWORD=your_docker_password
```

## 🖥️ 自定义服务器部署

### 使用 PM2

```bash
# 1. 安装 PM2
npm install -g pm2

# 2. 构建应用
npm run build

# 3. 启动应用
pm2 start npm --name "picg" -- start

# 4. 保存 PM2 配置
pm2 save
pm2 startup
```

### 使用 Nginx 反向代理

创建 Nginx 配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔧 环境变量配置

### 必需的环境变量

```bash
# GitHub API Token（用于访问 GitHub API）
# 需要以下权限：repo, read:user
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# 应用基础路径（用于子路径部署）
NEXT_PUBLIC_BASE_PATH=/your-repo-name

# 应用 URL
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### GitHub Token 配置

1. **创建 Personal Access Token**
   - 访问 GitHub Settings > Developer settings > Personal access tokens
   - 点击 "Generate new token (classic)"
   - 选择以下权限：
     - `repo` - 完整的仓库访问权限
     - `read:user` - 读取用户信息
   - 复制生成的 token

2. **在仓库中配置 Secret**
   - 进入仓库 Settings > Secrets and variables > Actions
   - 点击 "New repository secret"
   - Name: `GITHUB_TOKEN`
   - Value: 粘贴你的 token

### GitHub OAuth 登录配置

若要启用「使用 GitHub 登录」按钮的 OAuth Web 应用流程，需要创建一个 GitHub OAuth App 并配置以下环境变量：

```bash
# GitHub OAuth App 凭据
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# 可选：显式覆盖回调 URL，默认根据请求 origin 自动推断
# GITHUB_OAUTH_REDIRECT_URI=https://your-domain.com/api/auth/github/callback

# 可选：自定义 scope，默认 "repo workflow read:user user:email"
# GITHUB_OAUTH_SCOPE=repo workflow read:user user:email
```

1. 访问 <https://github.com/settings/developers> → OAuth Apps → New OAuth App
2. Homepage URL 填写部署站点（本地可填 `http://localhost:3000`）
3. Authorization callback URL 必须与 `GITHUB_OAUTH_REDIRECT_URI`（或默认推断值 `<origin>/api/auth/github/callback`）一致
4. 生成 Client secret 并把 Client ID / Secret 配置到运行环境
5. 注意：OAuth 回调依赖 Next.js API Route（服务器端），纯静态托管（例如 GitHub Pages）无法使用，可改用「输入 GitHub Token」

### 可选的环境变量

```bash
# Vercel 部署
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_vercel_org_id
VERCEL_PROJECT_ID=your_vercel_project_id

# Docker Hub
DOCKER_USERNAME=your_username
DOCKER_PASSWORD=your_password

# 自定义配置
NODE_ENV=production
CUSTOM_KEY=your_value
```

### GitHub Secrets 配置

在 GitHub 仓库设置中添加以下 Secrets：

1. **Settings** > **Secrets and variables** > **Actions**
2. 点击 **New repository secret**
3. 添加以下必需的 secrets：

#### 必需的 Secrets
```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # GitHub Personal Access Token
```

#### 可选的 Secrets（根据部署方式选择）
```bash
# Vercel 部署
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_vercel_org_id  
VERCEL_PROJECT_ID=your_vercel_project_id

# Docker Hub 部署
DOCKER_USERNAME=your_docker_username
DOCKER_PASSWORD=your_docker_password
```

#### Variables 配置
在 **Variables** 标签页中添加：
```bash
NEXT_PUBLIC_BASE_PATH=/your-repo-name  # 用于 GitHub Pages 子路径部署
```

## 🔍 故障排除

### 常见问题

#### 1. GitHub Pages 部署失败

```bash
# 检查 GitHub Actions 日志
# 确保启用了 GitHub Pages
# 检查分支设置是否正确
```

#### 2. 静态导出失败

```bash
# 检查是否使用了不支持静态导出的功能
# 确保所有图片使用 unoptimized: true
# 检查 API 路由是否正确处理
```

#### 3. Docker 构建失败

```bash
# 检查 Dockerfile 语法
# 确保 .dockerignore 配置正确
# 检查依赖项是否完整
```

#### 4. 环境变量未生效

```bash
# 检查变量名是否正确
# 确保在正确的环境中设置
# 重启应用服务
```

### 调试命令

```bash
# 检查构建输出
npm run build

# 本地测试静态导出
npm run export
npx serve out

# 检查 Docker 镜像
docker images
docker logs container_id

# 检查环境变量
printenv | grep NEXT_PUBLIC
```

## 📚 相关资源

- [Next.js 部署文档](https://nextjs.org/docs/deployment)
- [GitHub Pages 文档](https://docs.github.com/en/pages)
- [Vercel 部署指南](https://vercel.com/docs)
- [Docker 官方文档](https://docs.docker.com/)

## 🆘 获取帮助

如果遇到部署问题，请：

1. 检查 GitHub Actions 日志
2. 查看应用日志
3. 确认环境变量配置
4. 参考故障排除部分
5. 提交 Issue 寻求帮助