import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';
import { ThemeProvider } from '@/components/ThemeProvider';
import StyledComponentsRegistry from '@/lib/registry';

export const metadata: Metadata = {
  title: 'Pictor',
  description: 'A simple GitHub-based gallery app'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 防止FOUC的关键CSS */}
        <style dangerouslySetInnerHTML={{
          __html: `
            html, body {
              margin: 0;
              padding: 0;
              background: #fefdfb;
              color: #451a03;
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, Arial;
              transition: background-color 0.2s ease, color 0.2s ease;
            }
            /* 确保关键元素立即可见 */
            .container, main, nav { visibility: visible; }
          `
        }} />
      </head>
      <body>
        <StyledComponentsRegistry>
          <ThemeProvider>
            <Navbar />
            <main className="container">{children}</main>
          </ThemeProvider>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
