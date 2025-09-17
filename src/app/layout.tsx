import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Pictor',
  description: 'A simple GitHub-based gallery app'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Navbar />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
