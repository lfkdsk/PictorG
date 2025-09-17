import 'styled-components';
import { theme } from '@/lib/theme';

declare module 'styled-components' {
  export interface DefaultTheme {
    bg: string;
    text: string;
    textSecondary: string;
    surface: string;
    input: string;
    border: string;
    primary: string;
    hover: string;
    colorScheme: string;
  }
}
