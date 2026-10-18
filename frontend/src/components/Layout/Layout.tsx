import type { ReactNode } from 'react'
import styles from './Layout.module.css'

type LayoutProps = { children: ReactNode }

export function Layout({ children }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <a className={styles.skipLink} href="#conteudo">Pular para o conteúdo</a>
      <header className={styles.header}>
        <a className={styles.brand} href="https://www.youtube.com/" target="_blank" rel="noreferrer">
          <img className={styles.logo} src="/youtube.svg" alt="YouTube" />
        </a>
        <a className={styles.name} href="/">YouTubeNER</a>
      </header>
      <main id="conteudo" className={styles.main} tabIndex={-1}>{children}</main>
    </div>
  )
}
