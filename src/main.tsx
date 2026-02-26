import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Import CSS
import './css/app.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
