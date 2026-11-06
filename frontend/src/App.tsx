import { Route, Routes, useParams } from 'react-router-dom'
import Pitch from './pages/Pitch'
import DebateRoom from './pages/DebateRoom'

// Placeholder: the verdict page arrives in a later task.
function VerdictPlaceholder() {
  const { id } = useParams()
  return <main className="p-8 text-muted">Verdict for {id} is not built yet.</main>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Pitch />} />
      <Route path="/d/:id" element={<DebateRoom />} />
      <Route path="/d/:id/verdict" element={<VerdictPlaceholder />} />
    </Routes>
  )
}
