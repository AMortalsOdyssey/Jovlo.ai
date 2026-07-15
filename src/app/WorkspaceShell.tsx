import {
  BookOpen,
  CircleDollarSign,
  FileClock,
  FileText,
  MapPinned,
  Menu,
  Settings,
  Share2,
  Sparkles,
} from 'lucide-react'
import { type PropsWithChildren, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { IconButton } from '@/components'
import './app.css'

const fallbackTripId = 'hainan-loop-2026'

export function WorkspaceShell({ children }: PropsWithChildren) {
  const { tripId = fallbackTripId } = useParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const base = `/trips/${tripId}`

  const nav = [
    { to: `${base}/plan`, label: '行程', icon: MapPinned },
    { to: `${base}/budget`, label: '预算', icon: CircleDollarSign },
    { to: `${base}/sources`, label: '来源', icon: BookOpen },
    { to: `${base}/versions`, label: '版本', icon: FileClock },
    { to: `${base}/reports`, label: '报告', icon: FileText },
    { to: `${base}/share`, label: '分享', icon: Share2 },
    { to: `${base}/settings`, label: '设置', icon: Settings },
  ]

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <Link to="/trips" className="workspace-brand" aria-label="返回我的路书">
          <img src="/jovlo-mark.svg" alt="" />
          <span>Jovlo</span>
        </Link>

        <nav className="workspace-nav" aria-label="行程功能">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="workspace-actions">
          <Link className="workspace-import-link" to={`${base}/agent`}>
            <Sparkles aria-hidden="true" size={17} />
            Agent 协作
          </Link>
          <IconButton
            icon={Menu}
            label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
            className="workspace-menu-trigger"
            onClick={() => setMenuOpen((value) => !value)}
          />
        </div>
      </header>

      {menuOpen ? (
        <nav className="workspace-mobile-menu" aria-label="移动端行程功能">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
              <Icon aria-hidden="true" size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main className="workspace-content">{children ?? <Outlet />}</main>
    </div>
  )
}
