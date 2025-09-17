import Link from 'next/link';
import TokenForm from '@/components/TokenForm';

export const metadata = {
  title: 'Token 登录 - PicG'
};

export default function TokenLoginPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 64px)' }}>
      <section style={{ display: 'grid', gap: 18, padding: 12 }}>
        <div style={{ marginBottom: 4, justifySelf: 'start' }}>
          <Link 
            href="/login"
            style={{
              color: 'var(--primary)',
              textDecoration: 'none',
              fontWeight: '500',
              fontSize: '14px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'color-mix(in srgb, var(--primary), transparent 90%)',
              border: '1px solid color-mix(in srgb, var(--primary), transparent 70%)',
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              width: 'fit-content'
            }}
          >
            &lt; 返回
          </Link>
        </div>
        <h1 style={{ fontSize: 40, lineHeight: 1, margin: '8px 0', textAlign: 'center' }}>Pictor</h1>
        <TokenForm />
      </section>
    </div>
  );
}
