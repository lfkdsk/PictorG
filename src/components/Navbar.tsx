'use client';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { useEffect, useRef, useState } from 'react';
import { getGitHubToken, logout } from '@/lib/github';

type GhUser = { avatar_url: string; login: string };

export default function Navbar() {
  const [user, setUser] = useState<GhUser | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const token = getGitHubToken();
    if (!token) return;
    fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.avatar_url) setUser({ avatar_url: data.avatar_url, login: data.login });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handleLogout = () => {
    logout(); // 使用统一的logout函数
  };

  return (
    <header className="nav">
      <div className="inner">
        <div className="left-section">
          <Link href="/" className="brand" aria-label="home">
            <span className="brand-text">Pictor</span>
          </Link>
          <div className="nav-tabs">
            <span className="nav-tab active">我的画廊</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="actions" ref={menuRef}>
          <ThemeToggle />
          {user ? (
            <>
              <button className="avatar" onClick={() => setOpen((v) => !v)} aria-label="account">
                <img src={user.avatar_url} alt={user.login} />
              </button>
              {open ? (
                <div className="menu">
                  <div className="who">{user.login}</div>
                  <a href="/settings" className="menu-item">设置</a>
                  <button className="menu-item" onClick={handleLogout}>退出登录</button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <style jsx>{`
        .nav { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg), transparent 6%); backdrop-filter: blur(6px); }
        .inner { display: flex; align-items: center; width: min(1200px, 94vw); margin: 0 auto; padding: 10px 8px; }
        .left-section { display: flex; align-items: center; gap: 24px; }
        .brand { display: flex; align-items: center; text-decoration: none; padding: 8px 16px; border-radius: 12px; transition: all 0.2s ease; }
        .brand:hover { background: color-mix(in srgb, var(--primary), transparent 95%); transform: translateY(-1px); }
        .nav-tabs { display: flex; align-items: center; }
        .nav-tab { 
          display: flex; 
          align-items: center; 
          padding: 8px 16px; 
          color: var(--text-secondary); 
          font-weight: 500; 
          border-radius: 8px; 
          transition: all 0.2s ease;
          position: relative;
        }
        .nav-tab.active { 
          color: var(--primary); 
          font-weight: 600;
        }
        .brand-text { 
          font-weight: 800; 
          font-size: 20px;
          letter-spacing: -0.5px; 
          background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary), #30a0ff 50%)); 
          -webkit-background-clip: text; 
          background-clip: text; 
          color: transparent;
          text-shadow: 0 0 20px color-mix(in srgb, var(--primary), transparent 80%);
        }
        .spacer { flex: 1; }
        .actions { position: relative; display: flex; align-items: center; gap: 12px; }
        .avatar { width: 36px; height: 36px; border-radius: 9999px; border: 1px solid var(--border); padding: 0; overflow: hidden; background: var(--surface); cursor: pointer; transition: all 0.2s ease; }
        .avatar:hover { transform: scale(1.05); border-color: var(--primary); }
        .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .menu { position: absolute; right: 0; top: calc(100% + 8px); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; min-width: 160px; padding: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.12); }
        .who { font-size: 12px; opacity: .8; margin: 2px 8px 6px; }
        .menu-item { width: 100%; height: 34px; border: none; background: transparent; text-align: left; border-radius: 8px; padding: 0 8px; cursor: pointer; transition: background 0.2s ease; text-decoration: none; color: var(--text); display: flex; align-items: center; font-size: 14px; font-weight: 500; }
        .menu-item:hover { background: color-mix(in srgb, var(--primary), transparent 92%); }
      `}</style>
    </header>
  );
}
