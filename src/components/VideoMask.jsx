import { useRef, useEffect } from 'react'
import { usePortal } from '../context/PortalContext'

const VideoMask = () => {
  const { state, isAnimating, isShrinking, isExpanded, registerMaskRef } = usePortal()
  const maskRef = useRef(null)

  // Register the mask element with the portal context
  useEffect(() => {
    if (maskRef.current && registerMaskRef) {
      registerMaskRef(maskRef.current)
    }
  }, [registerMaskRef])

  const classes = [
    'video-mask',
    `state-${state}`,
    isAnimating ? 'animating' : '',
    isShrinking ? 'shrinking' : '',
    isExpanded ? 'expanded' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return <div ref={maskRef} className={classes}></div>
}

export default VideoMask
