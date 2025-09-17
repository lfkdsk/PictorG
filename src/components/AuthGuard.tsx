'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateCurrentToken, clearGitHubToken } from '@/lib/github';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function AuthGuard({ children, fallback }: AuthGuardProps) {
  const [isValidating, setIsValidating] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showEmergencyExit, setShowEmergencyExit] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isValid = await validateCurrentToken();
        setIsAuthenticated(isValid);
        
        if (!isValid) {
          // Token无效，清理所有缓存和cookie，然后重定向到登录页面
          clearGitHubToken();
          setTimeout(() => {
            router.push('/login');
          }, 100);
        }
      } catch (error) {
        console.error('Auth validation failed:', error);
        setIsAuthenticated(false);
        // 验证失败也清理token
        clearGitHubToken();
        // 显示紧急退出选项
        setShowEmergencyExit(true);
        setTimeout(() => {
          router.push('/login');
        }, 100);
      } finally {
        setIsValidating(false);
      }
    };

    checkAuth();
  }, [router]);

  const handleEmergencyExit = () => {
    clearGitHubToken();
    window.location.href = '/login'; // 强制跳转
  };

  if (isValidating) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div>验证身份中...</div>
        <div style={{ 
          width: '32px', 
          height: '32px', 
          border: '3px solid #f3f3f3',
          borderTop: '3px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        {showEmergencyExit && (
          <button 
            onClick={handleEmergencyExit}
            style={{
              marginTop: '20px',
              padding: '8px 16px',
              border: '1px solid #dc2626',
              background: 'transparent',
              color: '#dc2626',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            强制退出登录
          </button>
        )}
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback || (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>正在跳转到登录页面...</div>
      </div>
    );
  }

  return <>{children}</>;
}