type SocialCtaRowProps = {
  rowClassName?: string
  buttonClassName?: string
}

const SOCIAL_CTAS = [
  {
    href: 'https://over.world/',
    ariaLabel: 'Overworld website',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'
  },
  {
    href: 'https://x.com/overworld_ai',
    ariaLabel: 'Overworld on X',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
  },
  {
    href: 'https://discord.gg/overworld',
    ariaLabel: 'Overworld Discord',
    path: 'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'
  },
  {
    href: 'https://github.com/Overworldai',
    ariaLabel: 'Overworld GitHub',
    path: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'
  }
] as const

const ROW_CLASSES: Record<string, string> = {
  'menu-cta-row':
    'menu-cta-row absolute top-[var(--edge-top)] right-[var(--edge-right)] flex gap-[0.7cqw] pointer-events-auto',
  'pause-cta-row': 'pause-cta-row absolute right-[var(--edge-right)] top-[var(--edge-top)] flex gap-[0.6cqw]'
}

const SocialCtaRow = ({ rowClassName = 'menu-cta-row', buttonClassName = 'menu-cta-btn' }: SocialCtaRowProps) => {
  return (
    <div className={ROW_CLASSES[rowClassName] ?? rowClassName}>
      {SOCIAL_CTAS.map((cta) => (
        <a
          key={cta.href}
          href={cta.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClassName} w-[2.6cqw] h-[2.6cqw] min-w-[22px] min-h-[22px] m-0 grid place-items-center box-border text-[rgba(238,248,255,0.88)] bg-[rgba(7,13,24,0.24)] border border-[rgba(236,247,255,0.34)] rounded-[0.45cqw] no-underline cursor-pointer transition-[transform,border-color,background] duration-150 ease-in-out hover:-translate-y-px hover:border-white/60 hover:bg-[rgba(8,18,34,0.4)] [&>svg]:w-[62%] [&>svg]:h-[62%]`}
          aria-label={cta.ariaLabel}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d={cta.path} />
          </svg>
        </a>
      ))}
    </div>
  )
}

export default SocialCtaRow
