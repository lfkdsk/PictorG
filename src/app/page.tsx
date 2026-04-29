'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { validateCurrentToken, clearGitHubToken } from '@/lib/github';
import { consumeOAuthFragment, storeAuthData } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      // Step 1: check whether this is an OAuth callback (/#oauth_token=…).
      // This must happen before any token validation so the new token is
      // written to localStorage before we check it.
      const oauthResult = consumeOAuthFragment();

      if (oauthResult) {
        if ('error' in oauthResult) {
          // OAuth failed — surface the error on the login page.
          router.push(`/login?error=${encodeURIComponent(oauthResult.error)}`);
          return;
        }

        // Token received — fetch the user profile and persist everything.
        try {
          const resp = await fetch('https://api.github.com/user', {
            headers: { Authorization: `token ${oauthResult.token}` },
          });
          if (!resp.ok) throw new Error('Failed to fetch GitHub user');
          const user = await resp.json();
          storeAuthData(oauthResult.token, user);
          router.push('/main');
        } catch {
          router.push('/login?error=Failed+to+fetch+GitHub+user+profile');
        }
        return;
      }

      // Step 2: normal page load — validate any existing token.
      try {
        const isValid = await validateCurrentToken();
        if (isValid) {
          router.push('/main');
        } else {
          clearGitHubToken();
          router.push('/login');
        }
      } catch {
        clearGitHubToken();
        router.push('/login');
      }
    };

    init();
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <div>检查登录状态...</div>
      <div style={{
        width: '32px',
        height: '32px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }}></div>
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
