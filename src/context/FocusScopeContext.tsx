import { useEffect, useRef, type ReactNode } from 'react'
import { findFirstFocusable } from '../lib/focusNavigation'
import { pushScope, popScope, type FocusScope } from './focusScopeStack'

type FocusScopeProps = {
  children: ReactNode
  /** Called when B is pressed (or equivalent back gesture) while this is the top scope. */
  onCancel?: () => void
  /** Focus the first focusable descendant when the scope becomes active. */
  autoFocus?: boolean
  /** When false, the scope is not pushed onto the stack. Use this to keep an
   *  overlay mounted (for fade animations / scroll preservation) while only
   *  engaging navigation when the overlay is actually visible. Defaults to true. */
  active?: boolean
  /** Optional class name for the wrapping div. */
  className?: string
}

/** Scopes focus navigation to its subtree. The top scope on the stack wins —
 *  outer scopes are paused while a modal is open. */
const FocusScopeComponent = ({ children, onCancel, autoFocus, active = true, className }: FocusScopeProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!active) return
    const root = rootRef.current
    if (!root) return
    const scope: FocusScope = {
      root,
      getOnCancel: () => onCancelRef.current,
      previousFocus: document.activeElement
    }
    pushScope(scope)
    if (autoFocus) {
      findFirstFocusable(root)?.focus()
    }
    return () => {
      popScope(scope)
      const prev = scope.previousFocus
      if (prev instanceof HTMLElement && document.contains(prev)) {
        prev.focus()
      }
    }
  }, [active, autoFocus])

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  )
}

export default FocusScopeComponent
export { FocusScopeComponent as FocusScope }
