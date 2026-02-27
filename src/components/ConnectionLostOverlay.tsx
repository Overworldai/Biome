import { useStreaming } from '../context/StreamingContext'

const ConnectionLostOverlay = () => {
  const { connectionLost, dismissConnectionLost } = useStreaming()

  const handleDismiss = () => {
    dismissConnectionLost()
  }

  return (
    <div
      className={`connection-lost-overlay absolute inset-0 z-200 flex items-center justify-center bg-darkest/90 backdrop-blur-[4px] ${connectionLost ? 'active pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0'}`}
    >
      <div className="flex flex-col items-center gap-[2cqh] animate-[connectionLostFadeIn_0.4s_ease-out]">
        <div className="w-[8cqw] h-[8cqw] min-w-12 min-h-12 text-[rgba(255,120,120,0.9)] animate-[connectionLostPulse_2s_ease-in-out_infinite]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <span className="font-mono text-[3cqw] font-bold tracking-widest text-white/95 [text-shadow:0_0_20px_rgba(255,120,120,0.5),0_0_40px_rgba(255,120,120,0.3)]">
          CONNECTION LOST
        </span>
        <button
          className="mt-[1cqh] px-[3cqw] py-[1.2cqh] font-mono text-[1.5cqw] font-medium tracking-[0.15em] uppercase text-hud/90 bg-hud/10 border border-hud/40 rounded-lg cursor-pointer transition-all duration-200 ease-in-out hover:text-hud hover:bg-hud/20 hover:border-hud/60 hover:shadow-[0_0_20px_rgba(120,255,245,0.3)] active:scale-[0.97] active:bg-hud/25"
          onClick={handleDismiss}
        >
          RECONNECT
        </button>
      </div>
    </div>
  )
}

export default ConnectionLostOverlay
