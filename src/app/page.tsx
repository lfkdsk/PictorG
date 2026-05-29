'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { consumeOAuthFragment, storeAuthData } from '@/lib/auth';
import Landing from '@/components/Landing';

export default function HomePage() {
  const router = useRouter();
  // Only flips to true when this load is an OAuth callback (/#oauth_token=…).
  // Normal visits render the marketing landing page immediately.
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    // The lfkdsk-auth worker redirects back here with the token in the URL
    // fragment. Consume it before anything else so the new token is persisted
    // and we don't re-process it on refresh.
    const oauthResult = consumeOAuthFragment();
    if (!oauthResult) return; // normal page load — keep showing <Landing />

    setRedirecting(true);

    if ('error' in oauthResult) {
      router.push(`/login?error=${encodeURIComponent(oauthResult.error)}`);
      return;
    }

    (async () => {
      try {
        const resp = await fetch('https://api.github.com/user', {
          headers: { Authorization: `token ${oauthResult.token}` },
        });
        if (!resp.ok) throw new Error('Failed to fetch GitHub user');
        const user = await resp.json();
        storeAuthData(oauthResult.token, user);
        // Hard navigation so the persistent Navbar re-mounts and picks up the
        // freshly-stored gh_user.
        window.location.replace('/main');
      } catch {
        router.push('/login?error=Failed+to+fetch+GitHub+user+profile');
      }
    })();
  }, [router]);

  if (redirecting) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '70vh',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>正在登录...</div>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--border)',
          borderTop: '3px solid var(--primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return <Landing />;
}
