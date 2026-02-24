import { usePortal } from '../context/PortalContext'

const PortalBackgrounds = () => {
  const { state, states, showFlash } = usePortal()

  return (
    <>
      {/* Cold state - grid void */}
      <div className={`portal-background portal-background-cold ${state === states.COLD ? 'active' : ''}`}>
        <div className="grid-scanlines"></div>
      </div>

      {/* Warm state - hyperspace tunnel */}
      <div className={`portal-background portal-background-warm ${state === states.WARM ? 'active' : ''}`}>
        <div className="tunnel-rings">
          <div className="tunnel-ring"></div>
          <div className="tunnel-ring"></div>
          <div className="tunnel-ring"></div>
          <div className="tunnel-ring"></div>
          <div className="tunnel-ring"></div>
          <div className="tunnel-ring"></div>
        </div>
        <div className="warp-center"></div>
        {/* FAR layer */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
          <div key={`far-${n}`} className={`streak streak-far streak-${n}`}></div>
        ))}
        {/* MID layer */}
        {[13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((n) => (
          <div key={`mid-${n}`} className={`streak streak-mid streak-${n}`}></div>
        ))}
        {/* NEAR layer */}
        {[23, 24, 25, 26, 27, 28, 29, 30].map((n) => (
          <div key={`near-${n}`} className={`streak streak-near streak-${n}`}></div>
        ))}
      </div>

      {/* Hot state - flash transition */}
      <div
        className={`portal-background portal-background-hot ${state === states.HOT ? 'active' : ''} ${showFlash ? 'flash' : ''}`}
      ></div>
    </>
  )
}

export default PortalBackgrounds
