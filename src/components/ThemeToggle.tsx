'use client';
import { useEffect, useState } from 'react';

function getPreferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch(e) {}
  
  // 默认使用浅色主题，除非用户明确偏好暗色
  return 'light';
}

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const t = getPreferredTheme();
    setTheme(t);
    
    // 立即应用主题，避免闪烁
    const html = document.documentElement;
    html.setAttribute('data-theme', t);
    
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
