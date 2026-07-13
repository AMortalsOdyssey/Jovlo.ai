import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { AppProviders } from './app/providers'
import { reloadForStaleAsset } from './app/route-recovery'
import './design-system/tokens.css'
import './design-system/global.css'

window.addEventListener('vite:preloadError', (event) => {
  const preloadError = event as Event & { payload?: unknown }
  if (reloadForStaleAsset(preloadError.payload)) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AppProviders>
          <App />
        </AppProviders>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
