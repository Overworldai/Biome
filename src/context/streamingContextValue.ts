import { createContext, useContext } from 'react'
import type { StreamingContextValue } from './streamingContextTypes'

export const StreamingContext = createContext<StreamingContextValue | null>(null)

export const useStreaming = () => {
  const context = useContext(StreamingContext)
  if (!context) {
    throw new Error('useStreaming must be used within a StreamingProvider')
  }
  return context
}

export default StreamingContext
