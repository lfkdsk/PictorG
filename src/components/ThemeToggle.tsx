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
      {mounted ? (
        theme === 'light' ? (
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20.5 13.2A8.3 8.3 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" />
          </svg>
        )
      ) : (
        <span style={{ width: 19, height: 19, display: 'block' }} />
      )}
      <style jsx>{`
        .toggle {
          background: transparent;
          border: none;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          width: 40px;
          height: 40px;
          display: inline-grid;
          place-items: center;
          color: var(--text-secondary);
          border-radius: 10px;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .toggle:hover {
          color: var(--text);
          background: color-mix(in srgb, var(--text), transparent 92%);
        }
      `}</style>
    </button>
  );
}
