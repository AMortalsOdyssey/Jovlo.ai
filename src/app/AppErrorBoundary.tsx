import { Component, type ErrorInfo, type PropsWithChildren } from 'react'

import { isStaleAssetError } from './route-recovery'
import './app.css'

type AppErrorBoundaryState = {
  error: unknown | null
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown render error'
    console.error('Jovlo page render failed', message, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    const staleAssets = isStaleAssetError(this.state.error)
    return (
      <main className="app-route-error" role="alert">
        <img src="/jovlo-mark.svg" alt="" />
        <p>Jovlo</p>
        <h1>{staleAssets ? '页面版本刚刚更新' : '页面暂时没有正常打开'}</h1>
        <span>{staleAssets ? '重新载入即可继续，登录状态不会丢失。' : '你的路书仍然保留，可以重新载入后继续。'}</span>
        <button type="button" onClick={() => window.location.reload()}>重新载入</button>
      </main>
    )
  }
}
