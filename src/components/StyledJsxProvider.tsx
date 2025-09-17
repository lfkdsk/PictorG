'use client'

import { useServerInsertedHTML } from 'next/navigation'
import { StyleRegistry, createStyleRegistry } from 'styled-jsx'
import type { ReactNode } from 'react'
import { useRef } from 'react'

export default function StyledJsxProvider({
  children,
}: {
  children: ReactNode
}) {
  // Only create stylesheet once with lazy initial state
  // x-ref: https://reactjs.org/docs/hooks-reference.html#lazy-initial-state
  const jsxStyleRegistry = useRef<ReturnType<typeof createStyleRegistry> | undefined>()
  if (jsxStyleRegistry.current === undefined) {
    jsxStyleRegistry.current = createStyleRegistry()
  }

  useServerInsertedHTML(() => {
    if (jsxStyleRegistry.current) {
      return <>{jsxStyleRegistry.current.styles()}</>
    }
    return null
  })

  return (
    <StyleRegistry registry={jsxStyleRegistry.current}>
      {children}
    </StyleRegistry>
  )
}
