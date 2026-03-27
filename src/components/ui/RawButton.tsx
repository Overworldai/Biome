import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { useUISound } from '../../hooks/useUISound'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

type RawButtonProps = {
  variant: ButtonVariant
  children: ReactNode
  className?: string
  autoShrinkLabel?: boolean
  minLabelScale?: number
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-border-light outline-border-light bg-surface-btn-primary text-text-inverse',
  secondary:
    'border-border-light outline-border-light bg-surface-btn-secondary text-text-primary hover:bg-surface-btn-hover hover:text-text-inverse hover:-translate-y-px',
  danger: 'border-danger outline-danger bg-danger text-text-primary'
}

const RawButton = ({
  variant,
  children,
  className = '',
  autoShrinkLabel = false,
  minLabelScale = 0.4,
  ...rest
}: RawButtonProps) => {
  const { playHover, playClick } = useUISound()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const labelWrapRef = useRef<HTMLSpanElement>(null)
  const labelTextRef = useRef<HTMLSpanElement>(null)
  const [labelScale, setLabelScale] = useState(1)

  useLayoutEffect(() => {
    if (!autoShrinkLabel) {
      setLabelScale(1)
      return
    }

    const updateLabelScale = () => {
      const labelWrap = labelWrapRef.current
      const labelText = labelTextRef.current
      if (!labelWrap || !labelText) return

      const availableWidth = labelWrap.getBoundingClientRect().width
      if (availableWidth <= 0) {
        setLabelScale(1)
        return
      }

      const requiredWidth = labelText.scrollWidth
      if (requiredWidth <= availableWidth) {
        setLabelScale(1)
        return
      }

      setLabelScale(Math.max(minLabelScale, availableWidth / requiredWidth))
    }

    updateLabelScale()
    const rafId = window.requestAnimationFrame(updateLabelScale)

    const button = buttonRef.current
    const labelWrap = labelWrapRef.current
    const labelText = labelTextRef.current
    if (!button || !labelWrap || !labelText || typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(rafId)
    }

    const observer = new ResizeObserver(updateLabelScale)
    observer.observe(button)
    observer.observe(labelWrap)
    observer.observe(labelText)

    return () => {
      window.cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [autoShrinkLabel, minLabelScale, children])

  const labelStyle = autoShrinkLabel
    ? ({ transform: `scale(${labelScale})`, transformOrigin: 'center center' } as CSSProperties)
    : undefined

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`inline-flex min-w-0 items-center justify-center text-center whitespace-nowrap overflow-hidden font-serif rounded-none cursor-pointer border outline-0 hover:outline-2 transition-[color,background-color,border-color,outline-color,transform,box-shadow] duration-150 ${variantClasses[variant]} ${className}`}
      onMouseEnter={playHover}
      onMouseDown={playClick}
      {...rest}
    >
      {autoShrinkLabel ? (
        <span
          ref={labelWrapRef}
          className="flex flex-1 min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-center"
        >
          <span ref={labelTextRef} className="inline-block whitespace-nowrap" style={labelStyle}>
            {children}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  )
}

export default RawButton
export type { RawButtonProps, ButtonVariant }
