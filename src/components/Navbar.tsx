'use client';
import Link from 'next/link';
import styled from 'styled-components';
import { useEffect, useRef, useState } from 'react';
import { getGitHubToken, logout } from '@/lib/github';
import { useTheme } from './ThemeProvider';

type GhUser = { avatar_url: string; login: string };

// Styled Components
const Nav = styled.header`
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid ${props => props.theme.border};
  background: ${props => props.theme.bg}cc; /* 6% transparency */
  backdrop-filter: blur(6px);
`;

const Inner = styled.div`
  display: flex;
  align-items: center;
  width: min(1200px, 94vw);
  margin: 0 auto;
  padding: 10px 8px;
`;

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`;

const Brand = styled(Link)`
  display: flex;
  align-items: center;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 12px;
  transition: all 0.2s ease;

  &:hover {
    background: ${props => props.theme.primary}0a; /* 95% transparency */
    transform: translateY(-1px);
  }
`;

const BrandText = styled.span`
  font-weight: 800;
  font-size: 20px;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, ${props => props.theme.primary}, ${props => props.theme.primary}80);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 20px ${props => props.theme.primary}33; /* 80% transparency */
`;

const NavTabs = styled.div`
  display: flex;
  align-items: center;
`;

const NavTab = styled.span<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  padding: 8px 16px;
  color: ${props => props.$active ? props.theme.primary : props.theme.textSecondary};
  font-weight: ${props => props.$active ? 600 : 500};
  border-radius: 8px;
  transition: all 0.2s ease;
  position: relative;
`;

const Spacer = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Avatar = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  border: 1px solid ${props => props.theme.border};
  padding: 0;
  overflow: hidden;
  background: ${props => props.theme.surface};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.05);
    border-color: ${props => props.theme.primary};
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const Menu = styled.div`
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  background: ${props => props.theme.surface};
  border: 1px solid ${props => props.theme.border};
  border-radius: 10px;
  min-width: 160px;
  padding: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
`;

const Who = styled.div`
  font-size: 12px;
  opacity: 0.8;
  margin: 2px 8px 6px;
`;

const MenuItem = styled.button`
  width: 100%;
  height: 34px;
  border: none;
  background: transparent;
  text-align: left;
  border-radius: 8px;
  padding: 0 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  text-decoration: none;
  color: ${props => props.theme.text};
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;

  &:hover {
    background: ${props => props.theme.primary}1a; /* 92% transparency */
  }
`;

const MenuLink = styled(Link)`
  width: 100%;
  height: 34px;
  border: none;
  background: transparent;
  text-align: left;
  border-radius: 8px;
  padding: 0 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  text-decoration: none;
  color: ${props => props.theme.text};
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;

  &:hover {
    background: ${props => props.theme.primary}1a; /* 92% transparency */
  }
`;

const ThemeToggleButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  width: 40px;
  height: 40px;
  display: inline-grid;
  place-items: center;
`;

export default function Navbar() {
  const [user, setUser] = useState<GhUser | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const token = getGitHubToken();
    if (!token) return;
    fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.avatar_url) setUser({ avatar_url: data.avatar_url, login: data.login });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handleLogout = () => {
    logout();
  };

  return (
    <Nav>
      <Inner>
        <LeftSection>
          <Brand href="/" aria-label="home">
            <BrandText>Pictor</BrandText>
          </Brand>
          <NavTabs>
            <NavTab $active>我的画廊</NavTab>
          </NavTabs>
        </LeftSection>
        <Spacer />
        <Actions ref={menuRef}>
          <ThemeToggleButton
            type="button"
            aria-label="toggle theme"
            onClick={toggleTheme}
            title={theme === 'light' ? '切换到深色' : '切换到浅色'}
          >
            {mounted ? (theme === 'light' ? '☀️' : '🌙') : ''}
          </ThemeToggleButton>
          {user ? (
            <>
              <Avatar onClick={() => setOpen((v) => !v)} aria-label="account">
                <img src={user.avatar_url} alt={user.login} />
              </Avatar>
              {open ? (
                <Menu>
                  <Who>{user.login}</Who>
                  <MenuLink href="/settings">设置</MenuLink>
                  <MenuItem onClick={handleLogout}>退出登录</MenuItem>
                </Menu>
              ) : null}
            </>
          ) : null}
        </Actions>
      </Inner>
    </Nav>
  );
}
