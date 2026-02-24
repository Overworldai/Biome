import { useEffect, useRef } from 'react'
import { usePortal } from '../context/PortalContext'

const ShutdownOverlay = () => {
  const { isShuttingDown, registerShutdownRef } = usePortal()
  const shutdownBgRef = useRef(null)

  useEffect(() => {
    if (registerShutdownRef) {
      registerShutdownRef(shutdownBgRef.current)
    }
  }, [registerShutdownRef])

  return (
    <div className={`shutdown-overlay ${isShuttingDown ? 'active' : ''}`}>
      <div ref={shutdownBgRef} className="shutdown-background"></div>
    </div>
  )
}

export default ShutdownOverlay
