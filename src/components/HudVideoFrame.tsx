// HUD Video Frame - the inner frame around the video area
// Bounded to video anchor points (80,70) to (720,430) in the 800x500 coordinate space
// This maintains its aspect ratio (640x360 = 16:9)

const HudVideoFrame = () => {
  return (
    <svg className="hud-video-frame w-full h-full max-w-full max-h-full aspect-video overflow-visible" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow-frame" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.9" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.85 0" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Video corner brackets - coordinates translated from (80,70) origin to (0,0) */}
      <g filter="url(#glow-frame)">
        {/* Top-left corner */}
        <path className="hud draw-path-delay-2" d="M 0 30 L 0 16 Q 0 0 16 0 L 30 0" />

        {/* Top-right corner */}
        <path className="hud draw-path-delay-2" d="M 610 0 L 624 0 Q 640 0 640 16 L 640 30" />

        {/* Bottom-left corner */}
        <path className="hud draw-path-delay-2" d="M 0 330 L 0 344 Q 0 360 16 360 L 30 360" />

        {/* Bottom-right corner */}
        <path className="hud draw-path-delay-2" d="M 610 360 L 624 360 Q 640 360 640 344 L 640 330" />

        {/* Side tick marks - left */}
        <path className="hud-dim draw-path-delay-3" d="M -14 50 L -14 310" />
        <path
          className="hud-dim draw-path-delay-3"
          d="M -14 90 L -2 90 M -14 140 L -6 140 M -14 190 L -2 190 M -14 240 L -6 240 M -14 290 L -2 290"
        />

        {/* Side tick marks - right */}
        <path className="hud-dim draw-path-delay-3" d="M 654 50 L 654 310" />
        <path
          className="hud-dim draw-path-delay-3"
          d="M 654 90 L 642 90 M 654 140 L 646 140 M 654 190 L 642 190 M 654 240 L 646 240 M 654 290 L 642 290"
        />

        {/* Corner dots */}
        <circle cx="30" cy="0" r="2.6" className="dot fade-in" />
        <circle cx="610" cy="0" r="2.2" className="dot-dim fade-in-delay" />
        <circle cx="30" cy="360" r="2.2" className="dot-dim fade-in-delay" />
        <circle cx="610" cy="360" r="2.6" className="dot fade-in" />
      </g>
    </svg>
  )
}

export default HudVideoFrame
