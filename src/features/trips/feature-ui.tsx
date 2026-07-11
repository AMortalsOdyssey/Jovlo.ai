import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type FormEventHandler,
  type PropsWithChildren,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

import './feature-pages.css'

export type Tone = 'neutral' | 'brand' | 'sea' | 'sky' | 'sun' | 'coral'

type PageShellProps = PropsWithChildren<{
  className?: string
  width?: 'default' | 'wide' | 'reading'
}>

export function PageShell({ children, className = '', width = 'default' }: PageShellProps) {
  return (
    <main className={`feature-page feature-page--${width} ${className}`.trim()}>
      {children}
    </main>
  )
}

type PageHeaderProps = {
  title: string
  description?: string
  eyebrow?: string
  backTo?: string
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({
  title,
  description,
  eyebrow,
  backTo,
  actions,
  meta,
}: PageHeaderProps) {
  return (
    <header className="feature-page-header">
      <div className="feature-page-heading">
        {backTo ? (
          <Link className="feature-back-link" to={backTo} aria-label="返回">
            <ArrowLeft aria-hidden="true" size={20} />
          </Link>
        ) : null}
        <div className="feature-page-heading-copy">
          {eyebrow ? <p className="feature-eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p className="feature-page-description">{description}</p> : null}
          {meta ? <div className="feature-page-meta">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="feature-page-actions">{actions}</div> : null}
    </header>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  icon?: LucideIcon
}

export function Button({
  variant = 'secondary',
  icon: Icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`feature-button feature-button--${variant} ${className}`.trim()}
    >
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </button>
  )
}

type ButtonLinkProps = {
  to: string
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'quiet'
  icon?: LucideIcon
  className?: string
}

export function ButtonLink({
  to,
  children,
  variant = 'secondary',
  icon: Icon,
  className = '',
}: ButtonLinkProps) {
  return (
    <Link className={`feature-button feature-button--${variant} ${className}`.trim()} to={to}>
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </Link>
  )
}

export function StatusBadge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: Tone }>) {
  return <span className={`feature-status feature-status--${tone}`}>{children}</span>
}

type Metric = {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: Tone
}

export function MetricStrip({ metrics, className = '' }: { metrics: Metric[]; className?: string }) {
  return (
    <dl className={`feature-metric-strip ${className}`.trim()}>
      {metrics.map((metric) => (
        <div className={`feature-metric feature-metric--${metric.tone ?? 'neutral'}`} key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
          {metric.note ? <span>{metric.note}</span> : null}
        </div>
      ))}
    </dl>
  )
}

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <section className="feature-empty" aria-labelledby="feature-empty-title">
      <Icon aria-hidden="true" size={56} strokeWidth={1.35} />
      <h2 id="feature-empty-title">{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="feature-empty-action">{action}</div> : null}
    </section>
  )
}

type ImpactBarProps = {
  summary: ReactNode
  detail?: ReactNode
  onApply: () => void
  onDiscard: () => void
  applyLabel?: string
  disabled?: boolean
}

export function ImpactBar({
  summary,
  detail,
  onApply,
  onDiscard,
  applyLabel = '应用',
  disabled = false,
}: ImpactBarProps) {
  return (
    <aside className="feature-impact-bar" aria-live="polite">
      <div className="feature-impact-copy">
        <CircleAlert aria-hidden="true" size={20} />
        <div>
          <strong>{summary}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
      </div>
      <div className="feature-impact-actions">
        <Button variant="quiet" onClick={onDiscard}>
          放弃
        </Button>
        <Button variant="primary" onClick={onApply} disabled={disabled}>
          {applyLabel}
        </Button>
      </div>
    </aside>
  )
}

type FormFieldProps = PropsWithChildren<{
  label: string
  hint?: string
  error?: string
  className?: string
}>

export function FormField({ label, hint, error, className = '', children }: FormFieldProps) {
  return (
    <label className={`feature-field ${className}`.trim()}>
      <span className="feature-field-label">{label}</span>
      {children}
      {error ? <span className="feature-field-error">{error}</span> : null}
      {!error && hint ? <span className="feature-field-hint">{hint}</span> : null}
    </label>
  )
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="feature-section-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

export function SaveStatus({ status, dirty }: { status?: string; dirty?: boolean }) {
  if (status === 'saving') {
    return (
      <span className="feature-save-status" role="status">
        <LoaderCircle className="feature-spin" aria-hidden="true" size={16} /> 保存中…
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="feature-save-status feature-save-status--failed" role="status">
        <CircleAlert aria-hidden="true" size={16} /> 未保存，点击重试
      </span>
    )
  }
  if (status === 'stale') {
    return (
      <span className="feature-save-status feature-save-status--warning" role="status">
        <CircleAlert aria-hidden="true" size={16} /> 行程已在别处更新
      </span>
    )
  }
  return (
    <span className="feature-save-status" role="status">
      <Check aria-hidden="true" size={16} /> {dirty ? '草稿有修改' : '已保存'}
    </span>
  )
}

export function RouteSpine({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <ol className={`feature-route-spine ${className}`.trim()}>{children}</ol>
}

export function RouteSpineItem({
  marker,
  title,
  meta,
  note,
  action,
  kind = 'stop',
}: {
  marker: ReactNode
  title: ReactNode
  meta?: ReactNode
  note?: ReactNode
  action?: ReactNode
  kind?: 'stop' | 'stay' | 'leg'
}) {
  return (
    <li className={`feature-route-item feature-route-item--${kind}`}>
      <span className="feature-route-marker" aria-hidden="true">
        {marker}
      </span>
      <div className="feature-route-content">
        <div className="feature-route-title-row">
          <strong>{title}</strong>
          {action}
        </div>
        {meta ? <div className="feature-route-meta">{meta}</div> : null}
        {note ? <p className="feature-route-note">{note}</p> : null}
      </div>
    </li>
  )
}

export function Stepper({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="feature-stepper" aria-label="创建进度">
      {labels.map((label, index) => {
        const step = index + 1
        const state = step < current ? 'done' : step === current ? 'current' : 'upcoming'
        return (
          <li className={`feature-step feature-step--${state}`} key={label} aria-current={state === 'current' ? 'step' : undefined}>
            <span>{state === 'done' ? <Check aria-hidden="true" size={15} /> : step}</span>
            <strong>{label}</strong>
            {index < labels.length - 1 ? <ChevronRight aria-hidden="true" size={16} /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="feature-segmented">
      <legend className="jovlo-sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={label}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function InlineForm({
  children,
  onSubmit,
  className = '',
}: PropsWithChildren<{ onSubmit: FormEventHandler<HTMLFormElement>; className?: string }>) {
  return (
    <form className={`feature-inline-form ${className}`.trim()} onSubmit={onSubmit}>
      {children}
    </form>
  )
}
