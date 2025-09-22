// 画廊模板系统

export interface TemplateVariable {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'email' | 'url' | 'textarea';
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
}

export interface TemplateFile {
  path: string;
  content: string;
  encoding?: 'base64' | 'utf8';
  url?: string; // 可选的网络URL，用于动态下载内容
}

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  variables: TemplateVariable[];
  files: TemplateFile[];
}

// 模板变量定义
export const GALLERY_TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    key: 'REPO_NAME',
    label: '画廊名称',
    description: '决定仓库名称和部署子域名',
    type: 'text',
    required: true,
    placeholder: 'my-gallery'
  },
  {
    key: 'USER_NAME',
    label: 'GitHub用户名',
    description: '你的GitHub用户名',
    type: 'text',
    required: true,
    placeholder: 'username'
  },
  {
    key: 'GIT_USER',
    label: 'Git用户名',
    description: '用于Git提交的用户名',
    type: 'text',
    required: true,
    placeholder: 'Your Name'
  },
  {
    key: 'GIT_EMAIL',
    label: 'Git邮箱',
    description: '用于Git提交的邮箱地址',
    type: 'email',
    required: true,
    placeholder: 'your.email@example.com'
  },
  {
    key: 'GALLERY_TITLE',
    label: '画廊标题',
    description: '显示在网站顶部的标题',
    type: 'text',
    required: true,
    defaultValue: '我的摄影画廊',
    placeholder: '我的摄影画廊'
  },
  {
    key: 'GALLERY_SUBTITLE',
    label: '画廊副标题',
    description: '显示在标题下方的副标题',
    type: 'text',
    required: false,
    defaultValue: '用镜头记录美好时光',
    placeholder: '用镜头记录美好时光'
  },
  {
    key: 'GALLERY_DESCRIPTION',
    label: '画廊描述',
    description: '画廊的详细描述',
    type: 'textarea',
    required: false,
    defaultValue: '这是我的个人摄影画廊，记录生活中的美好瞬间',
    placeholder: '这是我的个人摄影画廊，记录生活中的美好瞬间'
  },
  {
    key: 'FOOTER_LINK',
    label: '底部链接',
    description: '底部logo链接地址',
    type: 'url',
    required: false,
    defaultValue: 'https://github.com',
    placeholder: 'https://your-website.com'
  }
];

// 模板文件内容（使用变量占位符）
const CONFIG_YML_TEMPLATE = `title: {{GALLERY_TITLE}}
subtitle: {{GALLERY_SUBTITLE}}
description: {{GALLERY_DESCRIPTION}}
cover: 'https://github.com/lfkdsk/picx-images-hosting/raw/master/20230817/IMG_7586.4e91my1ve140.17iz0sa56gik.webp'
author: {{USER_NAME}}

footer_logo:
  use: self
  self:
    link: '{{FOOTER_LINK}}'
    src: 'https://github.com/lfkdsk/picx-images-hosting/raw/master/20230817/tripper2white.2pbuwaqvndu0.webp'

url: https://{{USER_NAME}}.github.io/{{REPO_NAME}}
root: /{{REPO_NAME}}

photography_page:
  slogan: true
  slogan_descr: 'The moments when I pressed the shutter, the moments are forever.'

google_analytics:
  use: gtag
  ga_id:
  ga_api:
  gtag_id: XXXXX

nav:
  地图:
    link: /location
    icon: local-two
  归档:
    link: https://{{USER_NAME}}.github.io/blog
    icon: inbox
  随机:
    link: /random
    icon: pic
  状态监控:
    link: /status
    icon: list-view
  时间线:
    link: /grid-all
    icon: grid-nine

thumbnail_url: https://cdn.jsdelivr.net/gh/{{USER_NAME}}/{{REPO_NAME}}@thumbnail/
base_url: https://cdn.jsdelivr.net/gh/{{USER_NAME}}/{{REPO_NAME}}@master`;

const WORKFLOW_YML_TEMPLATE = `name: run build.py

on:
  push:
    branches: [main]
  workflow_dispatch:
  # schedule:
  #   - cron: '0 12 * * *'

env:
  GIT_USER: {{GIT_USER}} # change to yourself
  GIT_EMAIL: {{GIT_EMAIL}} # change to yourself
  THEME_REPO: lfkdsk/hexo-theme-type
  THEME_BRANCH: main
  TEMPLATE_REPO: lfkdsk/album_template
  TEMPLATE_BRANCH: main
  THUMBNAIL_BRANCH: thumbnail

jobs:
  build:
    runs-on: ubuntu-latest
    environment: secrets
    steps:
    - name: Checkout template repo
      uses: actions/checkout@v3
      with:
        repository: \${{ env.TEMPLATE_REPO }}
        ref: \${{ env.TEMPLATE_BRANCE }}        
    - name: Checkout gallery repo
      uses: actions/checkout@v2
      with:
        path: gallery
    - name: Checkout public repo
      uses: actions/checkout@v2
      continue-on-error: true # allow error.      
      with:
        ref: gh-pages
        path: public        
    - name: Checkout thumbnail repo
      uses: actions/checkout@v2
      continue-on-error: true # allow error.      
      with:
        ref: thumbnail
        path: thumbnail_public        
    - name: Checkout theme repo
      uses: actions/checkout@v3
      with:
        repository: \${{ env.THEME_REPO }}
        ref: \${{ env.THEME_BRANCH }}        
        path: themes/hexo-theme-type
    - uses: actions/setup-python@v4
      with:
        python-version: '3.10' 
        cache: 'pip' # caching pip dependencies        
    - run: pip install -r requirements.txt
    - name: Generate Doc
      run: |
        echo $BASE_URL
        python build.py
        cat new_config.yml
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: 'npm'
    - name: Install Dependencies & Build
      run: |
        npm ci
        npm install hexo-cli -g
        hexo g --config new_config.yml
        ls ./public        
    - name: Deploy Thumbnail
      uses: peaceiris/actions-gh-pages@v3
      with:
        publish_dir: ./thumbnail_public
        publish_branch: thumbnail
        github_token: \${{ secrets.GH_PAGES_DEPLOY }}
        user_name: \${{ env.GIT_USER }}
        user_email: \${{ env.GIT_EMAIL }}
        commit_msg: \${{ github.event.head_commit.message }}          
    - name: Deploy
      uses: peaceiris/actions-gh-pages@v3
      with:
        publish_dir: ./public
        github_token: \${{ secrets.GH_PAGES_DEPLOY }}
        user_name: \${{ env.GIT_USER }}
        user_email: \${{ env.GIT_EMAIL }}
        commit_msg: \${{ github.event.head_commit.message }}  `;

const README_YML_TEMPLATE = `模式口 · 拍猫:
  url: Cat
  date: "2023-09-01"
  style: fullscreen
  cover: Cat/15.jpg

羊:
  url: Nature
  date: "2023-09-02"
  style: fullscreen
  cover: Nature/16.webp

颐和园:
  url: Landscape
  date: "2023-09-03"
  style: fullscreen
  cover: Landscape/17.webp`;

const README_MD_TEMPLATE = `# {{GALLERY_TITLE}}

{{GALLERY_DESCRIPTION}}

这是一个基于GitHub的摄影画廊，使用PicG创建。

## 特性

- 📸 优雅的照片展示
- 🎨 响应式设计
- 🚀 GitHub Pages自动部署
- 📱 移动端友好

## 使用方法

1. 在相册目录中添加照片
2. 更新README.yml文件
3. 推送到GitHub，自动部署

## 部署地址

https://{{USER_NAME}}.github.io/{{REPO_NAME}}

---

由 [PicG](https://github.com/your-username/PicG) 创建`;

const GITIGNORE_TEMPLATE = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Production
/build
/dist
/public

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Temporary folders
tmp/
temp/`;

// 画廊模板定义
export const GALLERY_TEMPLATE: GalleryTemplate = {
  id: 'default-gallery',
  name: '默认画廊模板',
  description: '包含基础配置和示例相册的完整画廊模板',
  variables: GALLERY_TEMPLATE_VARIABLES,
  files: [
    {
      path: 'CONFIG.yml',
      content: CONFIG_YML_TEMPLATE,
      encoding: 'utf8'
    },
    {
      path: '.github/workflows/main.yml',
      content: WORKFLOW_YML_TEMPLATE,
      encoding: 'utf8'
    },
    {
      path: 'README.yml',
      content: README_YML_TEMPLATE,
      encoding: 'utf8'
    },
    {
      path: 'README.md',
      content: README_MD_TEMPLATE,
      encoding: 'utf8'
    },
    {
      path: '.gitignore',
      content: GITIGNORE_TEMPLATE,
      encoding: 'utf8'
    },
    {
      path: '.github/.gitkeep',
      content: '',
      encoding: 'utf8'
    },
    {
      path: '.github/workflows/.gitkeep',
      content: '',
      encoding: 'utf8'
    },
    {
      path: 'Cat/15.jpg',
      content: '', // 将从本地静态文件获取
      encoding: 'base64',
      url: '/gallery-assets/15.jpg'
    },
    {
      path: 'Nature/16.webp',
      content: '', // 将从本地静态文件获取
      encoding: 'base64',
      url: '/gallery-assets/16.webp'
    },
    {
      path: 'Landscape/17.webp',
      content: '', // 将从本地静态文件获取
      encoding: 'base64',
      url: '/gallery-assets/17.webp'
    }
  ]
};

// 模板变量替换函数
export function replaceTemplateVariables(
  template: string, 
  variables: Record<string, string>
): string {
  let result = template;
  
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, value || '');
  });
  
  return result;
}

// 处理模板文件
export function processTemplateFiles(
  template: GalleryTemplate,
  variables: Record<string, string>
): TemplateFile[] {
  return template.files.map(file => ({
    ...file,
    content: replaceTemplateVariables(file.content, variables)
  }));
}

// 获取画廊模板
export function getGalleryTemplate(): GalleryTemplate {
  return GALLERY_TEMPLATE;
}