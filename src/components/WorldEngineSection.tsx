import SettingsSection from './ui/SettingsSection'
import SettingsButton from './ui/SettingsButton'

type WorldEngineSectionProps = {
  engineReady: boolean | null
  onReinstallClick: () => void
}

const WorldEngineSection = ({ engineReady, onReinstallClick }: WorldEngineSectionProps) => {
  return (
    <SettingsSection
      title="World Engine"
      description={
        <span className="inline-flex items-center gap-[0.71cqh]">
          is the local engine healthy?{' '}
          {engineReady === null ? (
            'checking...'
          ) : engineReady ? (
            <>
              yes
              <span className="inline-block w-[0.98cqh] h-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)] shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]" />
            </>
          ) : (
            <>
              no
              <span className="inline-block w-[0.98cqh] h-[0.98cqh] rounded-full bg-[rgba(255,120,80,0.95)] shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]" />
            </>
          )}
        </span>
      }
    >
      <div className="flex justify-start">
        <SettingsButton variant="secondary" onClick={onReinstallClick}>
          Reinstall
        </SettingsButton>
      </div>
    </SettingsSection>
  )
}

export default WorldEngineSection
