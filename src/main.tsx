import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/ibm-plex-sans/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import { App } from './app/App'
import { AppProviders } from './app/providers'
import './design-system/tokens.css'
import './design-system/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
)
