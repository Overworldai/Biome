// Window Corner Anchors - visual indicators of actual window boundaries
// These stay fixed at the window corners regardless of content scaling

const WindowAnchors = () => {
  return (
    <div className="window-anchors">
      {/* Top-left anchor */}
      <svg className="anchor anchor-tl" width="32" height="32" viewBox="0 0 32 32">
        <defs>
          <filter id="anchor-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.9 0" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#anchor-glow)">
          <path d="M 8 2 L 2 2 L 2 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="2" cy="2" r="2.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>

      {/* Top-right anchor */}
      <svg className="anchor anchor-tr" width="32" height="32" viewBox="0 0 32 32">
        <g filter="url(#anchor-glow)">
          <path d="M 24 2 L 30 2 L 30 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="30" cy="2" r="2.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>

      {/* Bottom-left anchor */}
      <svg className="anchor anchor-bl" width="32" height="32" viewBox="0 0 32 32">
        <g filter="url(#anchor-glow)">
          <path d="M 8 30 L 2 30 L 2 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="2" cy="30" r="2.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>

      {/* Bottom-right anchor */}
      <svg className="anchor anchor-br" width="32" height="32" viewBox="0 0 32 32">
        <g filter="url(#anchor-glow)">
          <path d="M 24 30 L 30 30 L 30 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="30" cy="30" r="2.5" fill="currentColor" opacity="0.6" />
        </g>
      </svg>
    </div>
  )
}

export default WindowAnchors
