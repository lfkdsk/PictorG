// 主题配置
export const theme = {
  light: {
    bg: '#fefdfb',
    text: '#451a03',
    textSecondary: '#78716c',
    surface: '#f7f3f0',
    input: '#faf8f5',
    border: '#e7e5e4',
    primary: '#a16207',
    hover: '#f5f5f5',
    colorScheme: 'light',
  },
  dark: {
    bg: '#1c1917',
    text: '#fef7ed',
    textSecondary: '#d6d3d1',
    surface: '#292524',
    input: '#1c1917',
    border: '#57534e',
    primary: '#fbbf24',
    hover: '#44403c',
    colorScheme: 'dark',
  },
} as const;

export type Theme = typeof theme.light;
export type ThemeMode = keyof typeof theme;
