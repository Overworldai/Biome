import { useUISound } from '../hooks/useUISound'
import SceneCardBase from './SceneCardBase'

interface SceneCardAddButtonProps {
  onClick: () => void
  title?: string
  disabled?: boolean
}

const UploadIcon = () => (
  <svg className="h-[2.67cqh] w-[2.67cqh]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SceneCardAddButton = ({ onClick, title, disabled }: SceneCardAddButtonProps) => {
  const { playClick } = useUISound()

  return (
    <SceneCardBase
      title={title}
      disabled={disabled}
      onClick={() => {
        playClick()
        onClick()
      }}
      className="
        grid place-items-center text-text-primary
        hover:border-white
        disabled:pointer-events-none disabled:opacity-60
      "
    >
      <UploadIcon />
    </SceneCardBase>
  )
}

export default SceneCardAddButton
