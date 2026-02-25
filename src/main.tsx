import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Import CSS
import './css/styles.css'
import './css/holo-frame.css'
import './css/video-mask.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
