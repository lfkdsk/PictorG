'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import styled from 'styled-components';
import { validateCurrentToken } from '@/lib/github';

// Styled Components
const Wrap = styled.section`
  display: grid;
  gap: 16px;
  padding: 12px 0;
`;

const Brand = styled.h1`
  font-size: 40px;
  line-height: 1;
  margin: 8px 0;
`;

const Actions = styled.div`
  display: grid;
  gap: 12px;
  width: 260px;
`;

const Button = styled.button<{ $outline?: boolean }>`
  height: 44px;
  min-width: 220px;
  border-radius: 10px;
  border: none;
  background: ${props => props.$outline ? 'transparent' : props.theme.primary};
  color: ${props => props.$outline ? 'inherit' : '#fff'};
  font-weight: 600;
  text-align: center;
  display: inline-grid;
  place-items: center;
  padding: 0 16px;
  cursor: pointer;
  border: ${props => props.$outline ? `2px solid ${props.theme.border}` : 'none'};
`;

export default function LoginOptions() {
  const router = useRouter();

  // 检查是否已有有效token，如果有则跳转到main
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const isValid = await validateCurrentToken();
        if (isValid) {
          router.push('/main');
        }
      } catch {
        // Token验证失败，留在登录页面
        console.log('No valid token found, staying on login page');
      }
    };

    checkExistingAuth();
  }, [router]);

  const onGithubLogin = () => {
    // TODO: integrate GitHub OAuth
    console.log('GitHub OAuth login clicked');
  };

  return (
    <Wrap aria-label="login-options">
      <Brand>Pictor</Brand>

      <Actions>
        <Button type="button" onClick={onGithubLogin}>
          使用 GitHub 登录
        </Button>
        <Button type="button" $outline onClick={() => router.push('/login/token')}>
          输入 GitHub Token
        </Button>
      </Actions>
    </Wrap>
  );
}
