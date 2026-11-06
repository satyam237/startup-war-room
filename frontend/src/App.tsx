import { Route, Routes } from 'react-router-dom'
import Pitch from './pages/Pitch'
import DebateRoom from './pages/DebateRoom'
import Verdict from './pages/Verdict'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Pitch />} />
      <Route path="/d/:id" element={<DebateRoom />} />
      <Route path="/d/:id/verdict" element={<Verdict />} />
    </Routes>
  )
}
