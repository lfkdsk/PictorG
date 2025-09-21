# 📸 PicG - GitHub相册管理系统

> 基于GitHub的现代化相册管理平台，让你的GitHub仓库变身精美相册

## 🌟 特色功能

- 🔐 **GitHub OAuth登录** - 安全便捷的认证方式
- 📁 **仓库相册** - 将GitHub仓库转换为在线相册
- 🖼️ **多种布局** - 网格、瀑布流、紧凑、大图模式
- 📤 **智能上传** - 支持批量上传和自动压缩
- 🎨 **主题切换** - 明暗主题随心选择
- 📱 **响应式** - 完美适配手机和电脑

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置GitHub OAuth
1. 访问 [GitHub设置](https://github.com/settings/applications/new) 创建OAuth应用
2. 创建 `.env.local` 文件：
```bash
NEXT_PUBLIC_GITHUB_CLIENT_ID=你的ClientID
GITHUB_CLIENT_SECRET=你的ClientSecret
NEXT_PUBLIC_GITHUB_REDIRECT_URI=http://localhost:3001/auth/callback
```

### 3. 启动项目
```bash
npm run dev
```

访问 http://localhost:3001 开始使用！

## 📖 使用指南

### 首次配置
1. 访问 `/setup` 页面使用配置向导
2. 按步骤创建GitHub OAuth应用
3. 复制配置到 `.env.local` 文件

### 创建相册
1. 登录后点击"新建"按钮
2. 选择或创建GitHub仓库
3. 设置相册信息和封面
4. 开始上传照片

### 管理相册
- **编辑信息**: 点击相册页面的编辑按钮
- **上传照片**: 拖拽或点击上传区域
- **删除照片**: 进入删除模式选择照片
- **删除相册**: 相册页面底部的删除按钮

## 🛠️ 技术栈

- **前端**: Next.js 14 + React 18 + TypeScript
- **样式**: Styled JSX + CSS Modules
- **认证**: GitHub OAuth 2.0
- **存储**: GitHub仓库
- **部署**: Vercel / Docker

## 📂 项目结构

```
src/
├── app/           # 页面路由
├── components/    # React组件
├── lib/          # 工具函数
└── types/        # 类型定义
```

## 🚀 部署

### Vercel一键部署
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/PicG)

### Docker部署
```bash
docker build -t picg .
docker run -p 3000:3000 picg
```

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可证

MIT License

---

⭐ 如果觉得有用，请给个星星支持一下！