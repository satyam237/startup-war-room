import { Route, Routes, useParams } from 'react-router-dom'
import Pitch from './pages/Pitch'
import Verdict from './pages/Verdict'

// Placeholders: the debate room and verdict pages arrive in later tasks.
function DebateRoomPlaceholder() {
  const { id } = useParams()
  return <main className="p-8 text-muted">Debate room for {id} is not built yet.</main>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Pitch />} />
      <Route path="/d/:id" element={<DebateRoomPlaceholder />} />
      <Route path="/d/:id/verdict" element={<Verdict />} />
    </Routes>
  )
}
