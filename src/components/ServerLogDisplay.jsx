import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'

// Determine log line color class based on content
const getLogClass = (line) => {
  if (line.includes('[ERROR]') || line.includes('FATAL') || line.includes('Error:')) {
    return 'log-error'
  }
  if (line.includes('[WARNING]') || line.includes('Warning:')) {
    return 'log-warning'
  }
  if (line.includes('[INFO]')) {
    return 'log-info'
  }
  if (line.includes('100%') || line.includes('SERVER READY') || line.includes('complete')) {
    return 'log-success'
  }
  return ''
}

const ServerLogDisplay = () => {
  const [logs, setLogs] = useState([])
  const containerRef = useRef(null)

  useEffect(() => {
    let unlisten

    const setupListener = async () => {
      unlisten = await listen('server-log', (event) => {
        const line = event.payload
        setLogs((prev) => {
          // Keep last 100 lines to prevent memory issues
          const newLogs = [...prev, line]
          if (newLogs.length > 100) {
            return newLogs.slice(-100)
          }
          return newLogs
        })
      })
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="server-log-display">
      <div className="server-log-header">
        <span className="server-log-title">ENGINE OUTPUT</span>
        <span className="server-log-indicator" />
      </div>
      <div className="server-log-content" ref={containerRef}>
        {logs.length === 0 ? (
          <div className="server-log-empty">Waiting for server output...</div>
        ) : (
          logs.map((line, index) => (
            <div key={index} className={`server-log-line ${getLogClass(line)}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ServerLogDisplay
