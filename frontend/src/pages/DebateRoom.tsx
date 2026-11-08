import { useEffect, useReducer, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getDebate } from '../lib/api'
import { connectDebate } from '../lib/sse'
import { debateReducer, initialDebateState } from '../lib/debateReducer'
import DebateView, { FINISHED } from '../components/DebateView'

const LOST_MESSAGE = 'The connection to this debate was lost, and it did not finish. Start a new debate to try again.'

export default function DebateRoom() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(debateReducer, initialDebateState)
  const [pitch, setPitch] = useState<string | undefined>()
  const [lost, setLost] = useState<string | null>(null)

  // An already-finished debate has nothing to watch: go straight to the verdict.
  useEffect(() => {
    let live = true
    getDebate(id)
      .then((d) => {
        if (live) setPitch(d.pitch)
        if (live && (d.verdict || FINISHED.includes(String(d.status)))) navigate(`/d/${id}/verdict`, { replace: true })
      })
      .catch(() => { /* the stream below reports problems */ })
    return () => { live = false }
  }, [id, navigate])

  // The browser gave up on the stream (e.g. a 503 while the server restarts). Ask the server what
  // became of the debate: a finished one goes to its verdict, anything else is a dead end.
  useEffect(() => {
    let live = true
    const lose = () => { if (live) setLost(LOST_MESSAGE) }
    const close = connectDebate(id, dispatch, () => {
      getDebate(id)
        .then((d) => {
          if (!live) return
          if (d.verdict || FINISHED.includes(String(d.status))) navigate(`/d/${id}/verdict`, { replace: true })
          else lose()
        })
        .catch(lose)
    })
    return () => { live = false; close() }
  }, [id, navigate])

  useEffect(() => {
    if (FINISHED.includes(state.status)) navigate(`/d/${id}/verdict`, { replace: true })
  }, [state.status, id, navigate])

  return <DebateView id={id} state={state} pitch={pitch} lost={lost} />
}
