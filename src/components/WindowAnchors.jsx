// Window Corner Anchors - visual indicators of actual window boundaries
// These stay fixed at the window corners regardless of content scaling

const WindowAnchors = () => {
  return (
    <div className="window-anchors">
      {/* Top-left anchor */}
      <svg className="anchor anchor-tl" width="48" height="48" viewBox="0 0 48 48">
        <defs>
          <filter id="anchor-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#anchor-glow)">
          <path d="M 16 3 L 3 3 L 3 16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="3" cy="3" r="3" fill="currentColor" opacity="0.8" />
        </g>
      </svg>

      {/* Top-right anchor */}
      <svg className="anchor anchor-tr" width="48" height="48" viewBox="0 0 48 48">
        <g filter="url(#anchor-glow)">
          <path d="M 32 3 L 45 3 L 45 16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="45" cy="3" r="3" fill="currentColor" opacity="0.8" />
        </g>
      </svg>

      {/* Bottom-left anchor */}
      <svg className="anchor anchor-bl" width="48" height="48" viewBox="0 0 48 48">
        <g filter="url(#anchor-glow)">
          <path d="M 16 45 L 3 45 L 3 32" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="3" cy="45" r="3" fill="currentColor" opacity="0.8" />
        </g>
      </svg>

      {/* Bottom-right anchor */}
      <svg className="anchor anchor-br" width="48" height="48" viewBox="0 0 48 48">
        <g filter="url(#anchor-glow)">
          <path d="M 32 45 L 45 45 L 45 32" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="45" cy="45" r="3" fill="currentColor" opacity="0.8" />
        </g>
      </svg>
    </div>
  )
}

export default WindowAnchors
