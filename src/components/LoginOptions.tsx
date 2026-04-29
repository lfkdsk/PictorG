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
        .wrap { display: grid; gap: 16px; padding: 12px 0; }
        .brand { font-size: 40px; line-height: 1; margin: 8px 0; }
        .actions { display: grid; gap: 12px; width: 260px; }
        .error { color: #dc2626; font-size: 14px; max-width: 280px; text-align: center; }
        .btn {
          height: 44px;
          min-width: 220px;
          border-radius: 10px;
          border: none;
          background: var(--primary);
          color: #fff;
          font-weight: 600;
          text-align: center;
          display: inline-grid;
          place-items: center;
          padding: 0 16px;
          cursor: pointer;
        }
        .btn.outline {
          background: transparent;
          color: inherit;
          border: 2px solid var(--border);
        }
      `}</style>
    </section>
  );
}
