import type { ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import octobMarkPng from '@/assets/octob.png'

/** In-app Octob brand mark. */
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
