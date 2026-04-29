import { Suspense } from 'react';
import LoginOptions from '@/components/LoginOptions';

export const metadata = {
  title: 'Login - PicG'
};

export default function LoginPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 64px)' }}>
      <Suspense fallback={null}>
        <LoginOptions />
      </Suspense>
    </div>
  );
}
