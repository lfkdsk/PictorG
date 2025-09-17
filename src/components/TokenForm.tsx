'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { validateGitHubToken, clearGitHubToken } from '@/lib/github';

// Styled Components
const Content = styled.div`
  display: grid;
  gap: 18px;
`;

const Row = styled.div`
  display: grid;
  grid-auto-flow: column;
  gap: 12px;
  align-items: center;

  @media (max-width: 520px) {
    grid-auto-flow: row;
  }
`;

const Input = styled.input`
  height: 44px;
  width: 380px;
  border-radius: 10px;
  border: 1px solid ${props => props.theme.border};
  background: ${props => props.theme.input};
  padding: 0 12px;

  @media (max-width: 520px) {
    width: 100%;
  }
`;

const Button = styled.button`
  height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: ${props => props.theme.primary};
  color: #fff;
  font-weight: 600;
  cursor: pointer;
`;

const SecondaryButton = styled.button`
  height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid ${props => props.theme.border};
  background: transparent;
  color: ${props => props.theme.text};
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: ${props => props.theme.hover};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const HelpLink = styled(Link)`
  color: ${props => props.theme.primary};
`;

const SavedMessage = styled.output`
  text-align: center;
  color: #10b981;
  display: block;
`;

const ErrorMessage = styled.p`
  text-align: center;
  color: #dc2626;
`;

export default function TokenForm() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // 页面加载时清理可能存在的无效token
  useEffect(() => {
    clearGitHubToken();
  }, []);

  const onRedirect = () => {
    try {
      window.location.replace('/main');
    } catch {}
  };

  const onClearCache = () => {
    clearGitHubToken();
    setError(null);
    setToken('');
    alert('缓存已清理，请重新输入Token');
  };

  const onSave = async () => {
    if (!token.trim()) {
      setError('请输入有效的Token');
      return;
    }

    setValidating(true);
    setError(null);

    try {
      // 验证token有效性
      const isValid = await validateGitHubToken(token.trim());

      if (!isValid) {
        setError('Token无效，请检查Token是否正确或是否有足够的权限');
        setValidating(false);
        return;
      }

      // Token有效，保存到本地存储
      localStorage.setItem('gh_token', token.trim());
      const days = 30;
      const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `gh_token=${encodeURIComponent(token.trim())}; Path=/; Expires=${expires}; SameSite=Lax`;

      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      setError(null);
      setTimeout(onRedirect, 200);
    } catch {
      setError('验证失败，请检查网络连接后重试');
    } finally {
      setValidating(false);
    }
  };

  return (
    <Content>
      <Row>
        <Input
          type="password"
          inputMode="text"
          placeholder="请输入 GitHub Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="github-token"
        />
        <Button onClick={onSave} disabled={!token.trim() || validating}>
          {validating ? '验证中...' : saved ? '已保存' : '保存'}
        </Button>
        <SecondaryButton onClick={onClearCache} disabled={validating}>
          清理缓存
        </SecondaryButton>
      </Row>

      <HelpLink
        href="https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token"
        target="_blank"
        rel="noreferrer"
      >
        如何生成?
      </HelpLink>

      {error ? (
        <ErrorMessage>{error}</ErrorMessage>
      ) : null}

      {saved ? (
        <SavedMessage role="status">
          已保存
        </SavedMessage>
      ) : null}
    </Content>
  );
}
