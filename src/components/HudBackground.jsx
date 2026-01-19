// HUD Background - maintains 800:500 aspect ratio
// This is the outer window frame that surrounds the entire UI

import { usePortal } from '../context/PortalContext'

const SocialLinks = () => {
  const { toggleSettings } = usePortal()

  return (
    <div className="hud-socials">
      <a href="https://over.world/" target="_blank" rel="noopener noreferrer" className="hud-social-link">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      </a>
      <a href="https://x.com/overworld_ai" target="_blank" rel="noopener noreferrer" className="hud-social-link">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      <a href="https://discord.gg/overworld" target="_blank" rel="noopener noreferrer" className="hud-social-link">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      </a>
      <a href="https://github.com/Overworldai" target="_blank" rel="noopener noreferrer" className="hud-social-link">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      </a>
      <button onClick={toggleSettings} className="hud-social-link hud-config-btn" title="Settings">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      </button>
    </div>
  )
}

const HudBackground = () => {
  return (
    <>
      <svg className="hud-background" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow-bg" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.9" result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.85 0" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background fill - solid fill, video frame sits on top */}
        <path
          className="hud-bg bg-fade"
          d="M 38 8 L 150 8 L 165 22 L 300 22 L 315 8 L 620 8 L 635 24 L 744 24
               L 770 50 L 770 125 L 784 140 L 784 360 L 768 376 L 768 448 L 742 474
               L 644 474 L 628 490 L 330 490 L 312 476 L 185 476 L 170 490 L 60 490
               L 32 462 L 32 382 L 16 366 L 16 140 L 30 126 L 30 46 L 16 30 L 16 8 L 38 8 Z"
        />

        {/* Outer window geometry */}
        <g filter="url(#glow-bg)">
          <path
            className="hud draw-path"
            d="M 38 8 L 150 8 L 165 22 L 300 22 L 315 8 L 620 8 L 635 24 L 744 24
                 L 770 50 L 770 125 L 784 140 L 784 360 L 768 376 L 768 448 L 742 474
                 L 644 474 L 628 490 L 330 490 L 312 476 L 185 476 L 170 490 L 60 490
                 L 32 462 L 32 382 L 16 366 L 16 140 L 30 126 L 30 46 L 16 30 L 16 8 L 38 8 Z"
          />

          <path
            className="hud-ghost draw-path-delay-1"
            d="M 152 42 L 306 42 L 324 28 L 608 28 L 626 44 L 728 44 L 748 64 L 748 116
                 M 752 438 L 730 460 L 634 460 L 616 476 L 342 476 L 322 462 L 178 462
                 L 160 476 L 74 476 L 44 448 L 44 390 L 30 376 L 30 140 L 42 128 L 42 42 L 152 42"
          />

          <circle cx="27" cy="19" r="3" className="dot fade-in" />
          <circle cx="748" cy="46" r="3" className="dot fade-in" />
          <circle cx="76" cy="460" r="3" className="dot-dim fade-in-delay" />
          <circle cx="748" cy="460" r="3" className="dot-dim fade-in-delay" />
        </g>

        {/* Top system band */}
        <circle cx="660" cy="56" r="4" className="dot fade-in" />
        <path className="hud-dim draw-path-delay-2" d="M 80 62 L 720 62" />

        {/* Bottom control bay */}
        <path className="hud draw-path-delay-2" filter="url(#glow-bg)" d="M 80 440 L 720 440" />

        <circle cx="150" cy="456" r="3" className="dot fade-in-delay" />
        <circle cx="300" cy="456" r="3" className="dot fade-in-delay" />
        <circle cx="450" cy="456" r="3" className="dot fade-in-delay" />
        <circle cx="600" cy="456" r="3" className="dot fade-in-delay" />
      </svg>
      <SocialLinks />
    </>
  )
}

export default HudBackground
