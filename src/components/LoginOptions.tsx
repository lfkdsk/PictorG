'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { validateCurrentToken } from '@/lib/github';

export default function LoginOptions() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [oauthError, setOauthError] = useState<string | null>(null);

  // 检查是否已有有效token，如果有则跳转到main
  useEffect(() => {
    const errParam = searchParams?.get('oauth_error');
    if (errParam) setOauthError(errParam);

    const checkExistingAuth = async () => {
      try {
        const isValid = await validateCurrentToken();
        if (isValid) {
          router.push('/main');
        }
      } catch (error) {
        // Token验证失败，留在登录页面
        console.log('No valid token found, staying on login page');
      }
    };

    checkExistingAuth();
  }, [router, searchParams]);

  const onGithubLogin = () => {
    // 使用服务器端 API 路由发起标准的 GitHub OAuth Web 应用流程
    window.location.href = '/api/auth/github';
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
        <p role="alert" className="error">GitHub 登录失败：{oauthError}</p>
      ) : null}

      <style jsx>{`
        .wrap { display: grid; gap: 16px; padding: 12px 0; }
        .brand { font-size: 40px; line-height: 1; margin: 8px 0; }
        .actions { display: grid; gap: 12px; width: 260px; }
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
        .error {
          color: #dc2626;
          text-align: center;
          margin: 0;
          font-size: 14px;
        }
      `}</style>
    </section>
  );
}
