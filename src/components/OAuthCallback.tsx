'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { validateGitHubToken } from '@/lib/github';

const HANDOFF_COOKIE = 'gh_oauth_handoff';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const [key, ...rest] = raw.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export default function OAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const token = readCookie(HANDOFF_COOKIE);
      if (!token) {
        setError('未能获取到登录凭证，请重新尝试。');
        return;
      }

      try {
        const ok = await validateGitHubToken(token);
        if (!ok) {
          clearCookie(HANDOFF_COOKIE);
          setError('GitHub 令牌校验失败，请重新登录。');
          return;
        }

        localStorage.setItem('gh_token', token);
        const days = 30;
        const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = `gh_token=${encodeURIComponent(token)}; Path=/; Expires=${expires}; SameSite=Lax`;

        clearCookie(HANDOFF_COOKIE);

        const returnTo = searchParams?.get('return_to');
        const target = returnTo && returnTo.startsWith('/') ? returnTo : '/main';
        router.replace(target as any);
      } catch (e) {
        setError('登录过程中发生错误，请重试。');
      }
    };

    run();
  }, [router, searchParams]);

  if (error) {
    return (
      <section style={{ display: 'grid', gap: 16, padding: 12, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>登录失败</h1>
        <p style={{ color: '#dc2626' }}>{error}</p>
        <button
          type="button"
          onClick={() => router.replace('/login')}
          style={{
            height: 44,
            padding: '0 16px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--primary)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            justifySelf: 'center'
          }}
        >
          返回登录
        </button>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 16, padding: 12, textAlign: 'center' }}>
      <div>正在完成 GitHub 登录...</div>
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid #f3f3f3',
          borderTop: '3px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          justifySelf: 'center'
        }}
      />
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
