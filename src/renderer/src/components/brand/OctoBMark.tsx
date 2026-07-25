import type { ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import octobMarkPng from '@/pet/registry/octob/assets/octob.png'

/** In-app Octob mark — PNG from pet registry (same asset as the desktop pet). */
export function OctobMark({
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
  return (
    <img
      src={octobMarkPng}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
      {...props}
    />
  )
}
