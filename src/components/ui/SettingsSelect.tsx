import { useState, useRef, useEffect } from 'react'

type SettingsSelectOption = {
  value: string
  label: string
  prefix?: string
}

type SettingsSelectProps = {
  options: SettingsSelectOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

const OptionContent = ({ option }: { option: SettingsSelectOption }) => (
  <span className="flex items-center justify-between w-full">
    {option.prefix ? <span className="text-[rgba(238,244,252,0.45)] lowercase">{option.prefix}</span> : <span />}
    <span>{option.label}</span>
  </span>
)

const SettingsSelect = ({ options, value, onChange, disabled }: SettingsSelectProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-full flex items-stretch cursor-pointer rounded-none border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)] p-0 outline-none"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className="flex-1 font-serif leading-[1.2] text-right text-[rgba(245,249,255,0.92)] p-[0.55cqh_1.42cqh] text-[2.67cqh]">
          {selectedOption ? <OptionContent option={selectedOption} /> : value}
        </span>
        <span className="flex items-center justify-center w-[3.56cqh] bg-[rgba(245,251,255,0.95)]">
          <svg className="w-[1.42cqh] h-[1.42cqh]" viewBox="0 0 10 6" fill="none">
            <path d="M0 0L5 6L10 0H0Z" fill="rgba(10,14,24,0.95)" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-10 top-full left-0 right-0 border border-[rgba(245,251,255,0.75)] border-t-0 bg-[rgba(12,18,30,0.98)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`w-full font-serif cursor-pointer rounded-none border-none outline-none p-[0.55cqh_1.42cqh] pr-[4.98cqh] text-[2.67cqh] ${
                option.value === value
                  ? 'bg-[rgba(245,251,255,0.15)] text-[rgba(245,249,255,0.95)]'
                  : 'bg-transparent text-[rgba(245,249,255,0.82)] hover:bg-[rgba(245,251,255,0.08)]'
              }`}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
            >
              <OptionContent option={option} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default SettingsSelect
