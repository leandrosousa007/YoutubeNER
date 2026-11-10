import type { ReactNode } from 'react'
import { Icon } from '../Icon/Icon'
import styles from './Layout.module.css'

type LayoutProps = { children: ReactNode; navigation: ReactNode; accessory?: ReactNode; wide?: boolean; home: () => void }

export function Layout({ children, navigation, accessory, wide, home }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <a className={styles.skipLink} href="#conteudo">Pular para o conteúdo</a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <button className={styles.brand} type="button" onClick={home} aria-label="YouTubeNER, voltar para Coleções">
            <span className={styles.logo}><Icon name="brand" width="23" height="23" /></span>
            <span>YouTubeNER</span>
          </button>
          <div className={styles.navigation}>{navigation}</div>
          <div className={styles.accessory}>{accessory}</div>
        </div>
      </header>
      <main id="conteudo" className={wide ? styles.wide : styles.main} tabIndex={-1}>{children}</main>
    </div>
  )
}
