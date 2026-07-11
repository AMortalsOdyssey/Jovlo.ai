import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { useState } from 'react'

type EmailFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

export function EmailField({ autoFocus, id, onChange, value }: EmailFieldProps) {
  return (
    <div className="auth-input-wrap">
      <Mail aria-hidden="true" size={18} />
      <input
        id={id}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="name@example.com"
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

type PasswordFieldProps = {
  id: string
  name?: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
}

export function PasswordField({ autoComplete, id, name = 'password', onChange, placeholder, value }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="auth-input-wrap auth-input-wrap--action">
      <LockKeyhole aria-hidden="true" size={18} />
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        className="auth-field-action"
        type="button"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        title={visible ? '隐藏密码' : '显示密码'}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
      </button>
    </div>
  )
}

