import type { ReactNode } from 'react'
import { ConnectionContext, type ConnectionContextValue } from './connection'
import { FramesContext, type FramesContextValue } from './frames'
import { InputContext, type InputContextValue } from './input'
import { SeedsContext, type SeedsContextValue } from './seeds'
import { SessionContext, type SessionContextValue } from './session'
import { SurfaceContext, type SurfaceContextValue } from './surface'
import { WebsocketContext, type WebsocketContextValue } from './websocket'

/** Bundle of values for each of the seven streaming contexts. The
 *  caller (`StreamingProvider`) memoises each one independently so a
 *  change in (say) `frames` doesn't invalidate `connection`
 *  consumers. */
export type StreamingContextValues = {
  connection: ConnectionContextValue
  session: SessionContextValue
  frames: FramesContextValue
  input: InputContextValue
  seeds: SeedsContextValue
  websocket: WebsocketContextValue
  surface: SurfaceContextValue
}

/** Wraps `children` in the seven streaming contexts.
 *
 *  The nesting order has no functional meaning — each provider is
 *  orthogonal — but is chosen so the most cross-cutting context
 *  (connection) sits on the outside and the most narrowly-used one
 *  (surface, consumed only by `<VideoContainer>`) sits at the inside. */
export function StreamingProviders({ values, children }: { values: StreamingContextValues; children: ReactNode }) {
  return (
    <ConnectionContext.Provider value={values.connection}>
      <SessionContext.Provider value={values.session}>
        <SeedsContext.Provider value={values.seeds}>
          <WebsocketContext.Provider value={values.websocket}>
            <InputContext.Provider value={values.input}>
              <FramesContext.Provider value={values.frames}>
                <SurfaceContext.Provider value={values.surface}>{children}</SurfaceContext.Provider>
              </FramesContext.Provider>
            </InputContext.Provider>
          </WebsocketContext.Provider>
        </SeedsContext.Provider>
      </SessionContext.Provider>
    </ConnectionContext.Provider>
  )
}
