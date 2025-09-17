'use client';
import { useEffect, useState } from 'react';

function getPreferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const t = getPreferredTheme();
    setTheme(t);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [mounted, theme]);

  return (
    <button
      type="button"
      aria-label="toggle theme"
      className="toggle"
      onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      title={theme === 'light' ? '切换到深色' : '切换到浅色'}
    >
      {mounted ? (theme === 'light' ? '☀️' : '🌙') : ''}
      <style jsx>{`
        .toggle {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          padding: 0;
          width: 40px;
          height: 40px;
          display: inline-grid;
          place-items: center;
        }
      `}</style>
    </button>
  );
}
