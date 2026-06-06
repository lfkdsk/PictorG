'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { validateCurrentToken } from '@/lib/github';
import { initiateGitHubOAuth } from '@/lib/auth';

export default function LoginOptions() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) setOauthError(decodeURIComponent(error));
  }, [searchParams]);

  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const isValid = await validateCurrentToken();
        if (isValid) router.push('/main');
      } catch {
        // no valid token — stay on login page
      }
    };

    checkExistingAuth();
  }, [router]);

  const onGithubLogin = () => {
    initiateGitHubOAuth();
  };

  return (
    <section aria-label="login-options" className="wrap">
      <h1 className="brand">Pictor</h1>

      <div className="actions">
        <button type="button" className="btn" onClick={onGithubLogin}>
          使用 GitHub 登录
        </button>
        <button type="button" className="btn outline" onClick={() => router.push('/login/token')}>
          输入 GitHub Token
        </button>
      </div>

      {oauthError ? (
        <p role="alert" className="error">{oauthError}</p>
      ) : null}

      <style jsx>{`
        .wrap { display: grid; gap: 16px; padding: 12px 0; justify-items: center; }
        .brand { font-family: var(--serif); font-weight: 600; font-size: 44px; line-height: 1; margin: 8px 0; letter-spacing: -0.5px; }
        .actions { display: grid; gap: 10px; width: 260px; }
        .error { color: #c8553d; font-size: 14px; max-width: 280px; text-align: center; }
        .btn {
          height: 46px;
          min-width: 220px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: var(--primary);
          color: var(--accent-fg);
          font-weight: 600;
          text-align: center;
          display: inline-grid;
          place-items: center;
          padding: 0 16px;
          cursor: pointer;
          transition: filter 0.15s ease, background 0.15s ease, border-color 0.15s ease;
        }
        .btn:hover { filter: brightness(1.06); }
        .btn.outline {
          background: transparent;
          color: inherit;
          border: 1px solid var(--border);
        }
        .btn.outline:hover { filter: none; border-color: var(--text-secondary); background: var(--hover); }
      `}</style>
    </section>
  );
}
