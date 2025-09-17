# Styled-JSX Configuration Guide

This project is configured to use `styled-jsx` with proper Server-Side Rendering (SSR) support.

## Configuration Overview

### 1. Provider Setup
The `StyledJsxProvider` component wraps the entire application and handles:
- Style registry creation and management
- Server-side style injection using `useServerInsertedHTML`
- Client-side hydration

### 2. SSR Support
- Styles are collected during server-side rendering
- Styles are injected into the HTML head before hydration
- No flash of unstyled content (FOUC)
- Proper hydration without style mismatches

### 3. Next.js Configuration
- `styled-jsx` is enabled by default in Next.js
- `styled-components` is disabled to avoid conflicts
- Proper webpack configuration for CSS handling

## Usage Examples

### Basic Styled Component
```tsx
export default function MyComponent() {
  return (
    <div className="container">
      <h1>Hello World</h1>
      <style jsx>{`
        .container {
          padding: 2rem;
          background: #f0f0f0;
          border-radius: 8px;
        }

        h1 {
          color: #333;
          margin: 0;
        }
      `}</style>
    </div>
  )
}
```

### Global Styles
```tsx
export default function GlobalStyles() {
  return (
    <style jsx global>{`
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto;
        margin: 0;
        padding: 0;
      }

      * {
        box-sizing: border-box;
      }
    `}</style>
  )
}
```

### Dynamic Styles
```tsx
export default function DynamicComponent({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="themed-container">
      <p>Dynamic styling based on theme</p>
      <style jsx>{`
        .themed-container {
          padding: 1rem;
          background: ${theme === 'light' ? '#ffffff' : '#333333'};
          color: ${theme === 'light' ? '#333333' : '#ffffff'};
          border-radius: 4px;
        }
      `}</style>
    </div>
  )
}
```

### Responsive Styles
```tsx
export default function ResponsiveComponent() {
  return (
    <div className="responsive-grid">
      <div className="item">Item 1</div>
      <div className="item">Item 2</div>
      <div className="item">Item 3</div>
      <style jsx>{`
        .responsive-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1fr;
        }

        @media (min-width: 768px) {
          .responsive-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (min-width: 1024px) {
          .responsive-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        .item {
          padding: 1rem;
          background: #f8f9fa;
          border-radius: 4px;
        }
      `}</style>
    </div>
  )
}
```

## Best Practices

### 1. Scoped Styles
- Use scoped styles (default) for component-specific styling
- Avoid global styles unless necessary
- Use CSS custom properties for theme values

### 2. Performance
- Keep styles close to components
- Use CSS-in-JS for dynamic styles
- Consider CSS modules for static styles

### 3. SSR Considerations
- All styles are automatically handled by the provider
- No manual style injection needed
- Styles are properly hydrated on the client

### 4. TypeScript Support
- Type definitions are included for `jsx` and `global` props
- Full IntelliSense support for CSS properties
- Type-safe dynamic styling

## File Structure
```
src/
├── components/
│   ├── StyledJsxProvider.tsx    # SSR provider
│   └── StyledExample.tsx        # Example component
├── types/
│   └── styled-jsx.d.ts         # TypeScript definitions
└── app/
    └── layout.tsx              # Provider integration
```

## Troubleshooting

### Common Issues
1. **Styles not appearing**: Ensure the component is wrapped by `StyledJsxProvider`
2. **Hydration mismatches**: Check for conditional rendering based on client-side state
3. **Global styles not working**: Use `jsx global` instead of `jsx`

### Debug Mode
Enable styled-jsx debug mode by setting:
```bash
STYLED_JSX_DEBUG=1 npm run dev
```

This will show which styles are being applied and help identify issues.
