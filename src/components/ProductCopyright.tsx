import './ui.css'

export type ProductCopyrightProps = {
  className?: string
}

export function ProductCopyright({ className = '' }: ProductCopyrightProps) {
  return (
    <footer className={`jovlo-copyright ${className}`.trim()}>
      <span>© 2026 jovlo.8xd.io</span>
      <span aria-hidden="true">·</span>
      <span>攻略规划 · 出行执行</span>
    </footer>
  )
}
