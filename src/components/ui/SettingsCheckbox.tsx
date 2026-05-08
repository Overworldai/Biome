import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import Checkbox from './Checkbox'
import SettingsRow from './SettingsRow'

type SettingsCheckboxProps = {
  label: TranslationKey
  description?: TranslationKey
  checked: boolean
  onChange: (checked: boolean) => void
}

const SettingsCheckbox = ({ label, description, checked, onChange }: SettingsCheckboxProps) => {
  const { t } = useTranslation()

  return (
    <SettingsRow label={t(label)} hint={description && t(description)} align="start">
      <Checkbox checked={checked} onChange={onChange} />
    </SettingsRow>
  )
}

export default SettingsCheckbox
