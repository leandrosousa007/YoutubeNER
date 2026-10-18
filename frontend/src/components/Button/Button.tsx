import type { ComponentProps } from 'react'
import styles from './Button.module.css'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary'
}

export function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`${styles.button} ${styles[variant]} ${className}`}
    />
  )
}
