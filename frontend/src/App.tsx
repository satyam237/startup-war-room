import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Pitch from './pages/Pitch'
import DebateRoom from './pages/DebateRoom'

// Verdict pulls in the chart library; keep it out of the first paint.
const Verdict = lazy(() => import('./pages/Verdict'))

export default function App() {
  return (
    <Suspense fallback={<main className="p-8 text-muted">Loading the verdict.</main>}>
    <Routes>
      <Route path="/" element={<Pitch />} />
      <Route path="/d/:id" element={<DebateRoom />} />
      <Route path="/d/:id/verdict" element={<Verdict />} />
    </Routes>
    </Suspense>
  )
}
