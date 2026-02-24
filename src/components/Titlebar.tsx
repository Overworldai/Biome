import { useTauriWindow } from '../hooks/useTauri'

const Titlebar = () => {
  const { minimize, close } = useTauriWindow()

  return (
    <div className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region></div>
      <div className="titlebar-title">BIOME</div>
      <div className="titlebar-controls">
        <button id="titlebar-minimize" className="titlebar-btn" onClick={minimize}>
          <svg viewBox="0 0 10 10">
            <path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button id="titlebar-close" className="titlebar-btn titlebar-close" onClick={close}>
          <svg viewBox="0 0 10 10">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default Titlebar
