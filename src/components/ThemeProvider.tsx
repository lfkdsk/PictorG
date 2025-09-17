'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createGlobalStyle, ThemeProvider as StyledThemeProvider } from 'styled-components';
import type { ThemeMode } from '@/lib/theme';
import { theme } from '@/lib/theme';

// 全局样式
const GlobalStyle = createGlobalStyle`
  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: ${props => props.theme.bg};
    color: ${props => props.theme.text};
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  /* 确保关键元素立即可见 */
  .container, main, nav {
    visibility: visible;
  }

  /* 布局辅助类 */
  .container {
    width: min(1200px, 94vw);
    margin: 0 auto;
    padding: 18px 8px 32px;
  }
`;

// 主题上下文
interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// 获取主题偏好
function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage 不可用
  }

  // 检查系统偏好
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  }

  return 'light';
}

// 主题提供者组件
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const preferredTheme = getPreferredTheme();
    setCurrentTheme(preferredTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // 应用主题到 document
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.documentElement.style.colorScheme = theme[currentTheme].colorScheme;

    // 保存到 localStorage
    try {
      localStorage.setItem('theme', currentTheme);
    } catch {
      // localStorage 不可用
    }
  }, [currentTheme, mounted]);

  const toggleTheme = () => {
    setCurrentTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const contextValue: ThemeContextType = {
    theme: currentTheme,
    setTheme: setCurrentTheme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      <StyledThemeProvider theme={theme[currentTheme]}>
        <GlobalStyle />
        {children}
      </StyledThemeProvider>
    </ThemeContext.Provider>
  );
}

// 使用主题的 Hook
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
