import { Suspense } from 'react';
import OAuthCallback from '@/components/OAuthCallback';

export const metadata = {
  title: 'GitHub 登录中 - PicG'
};

export const dynamic = 'force-dynamic';

export default function OAuthCallbackPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 64px)' }}>
      <Suspense fallback={<div>加载中...</div>}>
        <OAuthCallback />
      </Suspense>
    </div>
  );
}
