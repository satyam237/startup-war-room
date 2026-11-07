import { lazy, Suspense } from 'react'
import { Route, Routes, useSearchParams } from 'react-router-dom'
import Pitch from './pages/Pitch'
import { loadDebateRoom } from './lib/routes'

// Neither page is needed to pitch, and Verdict pulls in the chart library: keep both out of the first paint.
const DebateRoom = lazy(loadDebateRoom)
const Verdict = lazy(() => import('./pages/Verdict'))

// Dev-only scripted debate at /?demo=1. The DEV check is replaced with `false` in production builds,
// so the demo module is never bundled.
const DemoRoom = import.meta.env.DEV ? lazy(() => import('./dev/DemoRoom')) : null

function Home() {
  const [params] = useSearchParams()
  if (DemoRoom && params.get('demo') === '1') return <DemoRoom />
  return <Pitch />
}

export default function App() {
  return (
    <Suspense fallback={<main className="p-8 font-bold">Loading.</main>}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/d/:id" element={<DebateRoom />} />
      <Route path="/d/:id/verdict" element={<Verdict />} />
    </Routes>
    </Suspense>
  )
}
