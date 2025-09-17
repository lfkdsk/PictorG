/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  },
  
  // 图片优化配置
  images: {
    unoptimized: true // 为了兼容性，禁用图片优化
  },
  
  // 基础路径配置（用于GitHub Pages等子路径部署）
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || '',
  
  // 环境变量配置
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  
  // 构建时的环境变量
  publicRuntimeConfig: {
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  },
  
  // Webpack配置
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // 优化chunk分割以减少循环依赖
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true,
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            priority: -10,
            chunks: 'all',
          },
          common: {
            name: 'common',
            minChunks: 2,
            priority: -30,
            chunks: 'all',
            reuseExistingChunk: true,
          },
        },
      };
    }
    
    // 添加resolve别名以避免循环依赖
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    
    return config;
  },
  
  // 重定向配置
  async redirects() {
    return [
      // 可以在这里添加重定向规则
    ];
  },
  
  // 重写配置
  async rewrites() {
    return [
      // 可以在这里添加重写规则
    ];
  },
  
  // 头部配置
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
