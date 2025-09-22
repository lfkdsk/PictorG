'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { validateGitHubToken, clearGitHubToken } from '@/lib/github';

export default function TokenForm() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // 页面加载时清理可能存在的无效token
  useEffect(() => {
    clearGitHubToken();
  }, []);
  
  const onRedirect = () => {
    try {
      window.location.replace('/main');
    } catch {}
  };

  const onClearCache = () => {
    clearGitHubToken();
    setError(null);
    setToken('');
    alert('缓存已清理，请重新输入Token');
  };

  const onSave = async () => {
    if (!token.trim()) {
      setError('请输入有效的Token');
      return;
    }

    setValidating(true);
    setError(null);

    try {
      // 验证token有效性
      const isValid = await validateGitHubToken(token.trim());
      
      if (!isValid) {
        setError('Token无效，请检查Token是否正确或是否有足够的权限');
        setValidating(false);
        return;
      }

      // Token有效，保存到本地存储
      localStorage.setItem('gh_token', token.trim());
      const days = 30;
      const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `gh_token=${encodeURIComponent(token.trim())}; Path=/; Expires=${expires}; SameSite=Lax`;
      
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      setError(null);
      setTimeout(onRedirect, 200);
    } catch (e) {
      setError('验证失败，请检查网络连接后重试');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="content">
      <div className="row">
        <input
          type="password"
          inputMode="text"
          placeholder="请输入 GitHub Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="input"
          aria-label="github-token"
        />
        <button className="btn" onClick={onSave} disabled={!token.trim() || validating}>
          {validating ? '验证中...' : saved ? '已保存' : '保存'}
        </button>
        <button className="btn-secondary" onClick={onClearCache} disabled={validating}>
          清理缓存
        </button>
      </div>

      <Link
        href="https://github.com/settings/tokens"
        target="_blank"
        rel="noreferrer"
        className="help"
      >
        如何生成?
      </Link>

      {error ? (
        <p role="alert" className="error">{error}</p>
      ) : null}

      {saved ? (
        <p role="status" className="saved">
          已保存
        </p>
      ) : null}

      <style jsx>{`
        .content { display: grid; gap: 18px; }
        .row { display: grid; grid-auto-flow: column; gap: 12px; align-items: center; }
        .input { height: 44px; width: 380px; border-radius: 10px; border: 1px solid var(--border); background: var(--input); padding: 0 12px; }
        .btn { height: 44px; padding: 0 16px; border-radius: 10px; border: none; background: var(--primary); color: #fff; font-weight: 600; cursor: pointer; }
        .btn-secondary { height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--text); font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .btn-secondary:hover:not(:disabled) { background: var(--hover); }
        .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
        .help { color: var(--primary); }
        .saved { text-align: center; color: #10b981; }
        .error { text-align: center; color: #dc2626; }
        @media (max-width: 520px) { .row { grid-auto-flow: row; } .input { width: 100%; } }
      `}</style>
    </div>
  );
}
