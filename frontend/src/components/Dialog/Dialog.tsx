import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from '../Icon/Icon'
import s from './Dialog.module.css'

type Props = { title: string; close: () => void; children: ReactNode; description?: string; sheet?: boolean; busy?: boolean }

export function Dialog({ title, close, children, description, sheet, busy }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus()
    return () => dialog.close()
  }, [])

  return <dialog ref={ref} className={sheet ? s.sheet : s.dialog} aria-labelledby={id}
    aria-describedby={description ? id + '-description' : undefined}
    onCancel={e => { e.preventDefault(); if (!busy) close() }}
    onClick={e => { if (!busy && e.target === e.currentTarget) close() }}>
    <div className={s.inner}>
      <header className={s.header}>
        <h2 id={id}>{title}</h2>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={close}><Icon name="close" width="17" height="17" /></button>
      </header>
      {description && <p id={id + '-description'} className={s.description}>{description}</p>}
      <div className={s.content}>{children}</div>
    </div>
  </dialog>
}
