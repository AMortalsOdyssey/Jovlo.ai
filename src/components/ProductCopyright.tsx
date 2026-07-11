import './ui.css'

export type ProductCopyrightProps = {
  className?: string
}

export function ProductCopyright({ className = '' }: ProductCopyrightProps) {
  return (
    <footer className={`jovlo-copyright ${className}`.trim()}>
      <span>© 2026 Jovlo.ai</span>
      <span aria-hidden="true">·</span>
      <span>AI 路书共创</span>
    </footer>
  )
}
