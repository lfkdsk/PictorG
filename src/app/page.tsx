'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { validateCurrentToken, clearGitHubToken } from '@/lib/github';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const isValid = await validateCurrentToken();
        
        if (isValid) {
          // Token有效，跳转到main页面
          router.push('/main');
        } else {
          // Token无效，清理缓存并跳转到登录页面
          clearGitHubToken();
          router.push('/login');
        }
      } catch (error) {
        // 验证失败，清理缓存并跳转到登录页面
        console.error('Token validation failed:', error);
        clearGitHubToken();
        router.push('/login');
      }
    };

    checkAuthAndRedirect();
  }, [router]);

  // 显示加载状态
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
