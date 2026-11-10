import type { SVGProps } from 'react'

const paths = {
  brand: 'M8 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3m8-16h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M8 9h8m-8 6h6',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  annotate: 'M4 7h10M4 12h7M4 17h5m4-1 6-6 2 2-6 6-3 1z',
  tag: 'M3 5v6l9 9a2 2 0 0 0 3 0l5-5a2 2 0 0 0 0-3l-9-9H5a2 2 0 0 0-2 2zm5 3h.01',
  database: 'M4 6c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3zm0 0v6c0 2 3.6 3 8 3s8-1 8-3V6M4 12v6c0 2 3.6 3 8 3s8-1 8-3v-6',
  play: 'M9 5v14l11-7z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  plus: 'M12 5v14M5 12h14',
  search: 'M15.5 15.5 20 20M17 10.5A6.5 6.5 0 1 1 4 10.5a6.5 6.5 0 0 1 13 0z',
  close: 'm6 6 12 12M18 6 6 18',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  first: 'M5 5v14m12-13-6 6 6 6',
  last: 'M19 5v14M7 6l6 6-6 6',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-3a8 8 0 0 1 14-2m0 8a8 8 0 0 1-14 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>
}
