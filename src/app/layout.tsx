import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import StyledJsxProvider from '@/components/StyledJsxProvider';

export const metadata: Metadata = {
  title: 'PictorG — 基于 GitHub 的现代化相册管理平台',
  description:
    '把任意 GitHub 仓库变成精美的在线相册：OAuth 登录、批量上传与压缩、多种布局、明暗主题。提供 Web 版与 macOS 桌面端下载。'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 主题初始化脚本 - 必须在CSS之前执行 */}
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              function getTheme() {
                try {
                  var saved = localStorage.getItem('theme');
                  if (saved === 'light' || saved === 'dark') return saved;
                } catch(e) {}
                // 默认使用浅色主题
                return 'light';
              }
              var theme = getTheme();
              document.documentElement.setAttribute('data-theme', theme);
            })();
          `
        }} />

        {/* 防止FOUC的关键CSS */}
        <style dangerouslySetInnerHTML={{
          __html: `
            html, body {
              margin: 0;
              padding: 0;
              background: var(--bg, #fefdfb);
              color: var(--text, #451a03);
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, Arial;
              transition: background-color 0.2s ease, color 0.2s ease;
            }
            /* 确保关键元素立即可见 */
            .container, main, nav { visibility: visible; }
          `
        }} />
      </head>
      <body>
        <StyledJsxProvider>
          <Navbar />
          <main className="container">{children}</main>
        </StyledJsxProvider>
      </body>
    </html>
  );
}
