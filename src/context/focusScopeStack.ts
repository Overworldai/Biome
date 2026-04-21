/** Focus-scope stack for gamepad/keyboard navigation. Modals push a scope on
 *  mount so spatial navigation and the B=back handler are contained to them,
 *  and pop on unmount (restoring the previously-focused element). */

export type FocusScope = {
  root: HTMLElement
  getOnCancel: () => (() => void) | undefined
  previousFocus: Element | null
}

const stack: FocusScope[] = []

export const getTopFocusScope = (): FocusScope | null => stack[stack.length - 1] ?? null

/** Scope used when the stack is empty — spatial navigation searches the whole document. */
export const getActiveScopeRoot = (): ParentNode => getTopFocusScope()?.root ?? document

export const pushScope = (s: FocusScope) => stack.push(s)
export const popScope = (s: FocusScope) => {
  const idx = stack.lastIndexOf(s)
  if (idx >= 0) stack.splice(idx, 1)
}
