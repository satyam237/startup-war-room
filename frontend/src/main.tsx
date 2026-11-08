import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* domAnimation is the small feature set (no drag, no layout animation); reducedMotion drops transforms for visitors who ask. */}
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
)
