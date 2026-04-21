import type { ReactNode } from 'react'
import type { InputCode } from '../../types/input'
import SettingsRow from '../ui/SettingsRow'
import SettingsKeybind from '../ui/SettingsKeybind'

type KeybindRowProps =
  | {
      label: string
      value: InputCode
      onChange: (code: InputCode) => void
      warning?: ReactNode
      fixedLabel?: never
    }
  | { label: string; fixedLabel: string; value?: never; onChange?: never; warning?: never }

const KeybindRow = (props: KeybindRowProps) => {
  const hasError = props.fixedLabel === undefined && !!props.warning
  return (
    <SettingsRow label={props.label} hint={props.warning} hintError={hasError}>
      {props.fixedLabel !== undefined ? (
        <SettingsKeybind value={props.fixedLabel} disabled />
      ) : (
        <SettingsKeybind value={props.value} onChange={props.onChange} hasError={hasError} />
      )}
    </SettingsRow>
  )
}

export default KeybindRow
