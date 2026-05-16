import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { phishApi } from '../lib/api.js'

// ── Hardcoded quiz questions (Feature 2) ─────────────────────
const QUIZ_QUESTIONS = [
  {
    id: 'q1',
    text: 'What was the main red flag in this email?',
    options: [
      { key: 'a', label: 'Urgent language pressuring immediate action' },
      { key: 'b', label: 'The email came from a known sender' },
      { key: 'c', label: 'The email contained an official company logo' },
      { key: 'd', label: 'The message was very short' },
    ],
    correct: 'a',
  },
  {
    id: 'q2',
    text: 'What should you do when you receive a suspicious email?',
    options: [
      { key: 'a', label: 'Click the link to verify whether it is legitimate' },
      { key: 'b', label: 'Reply to the sender asking for more information' },
      { key: 'c', label: 'Report it to your IT / security team immediately' },
      { key: 'd', label: 'Forward it to colleagues to get their opinion' },
    ],
    correct: 'c',
  },
  {
    id: 'q3',
    text: 'Which of these is a sign of a phishing URL?',
    options: [
      { key: 'a', label: 'The URL starts with HTTPS' },
      { key: 'b', label: 'The domain is misspelled (e.g. cornpany.com)' },
      { key: 'c', label: 'The URL contains the company name' },
      { key: 'd', label: 'The URL is very long' },
    ],
    correct: 'b',
  },
]

// ── Quiz component ────────────────────────────────────────────
function AwarenessQuiz({ uuid }) {
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function selectAnswer(qid, key) {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [qid]: key }))
  }

  async function handleSubmit() {
    if (Object.keys(answers).length < QUIZ_QUESTIONS.length) return
    const correct = QUIZ_QUESTIONS.filter(q => answers[q.id] === q.correct).length
    setScore(correct)
    setSubmitting(true)
    try {
      await phishApi.submitQuiz(uuid, correct, answers)
    } catch {
      // Non-blocking — quiz result is best-effort
    } finally {
      setSubmitting(false)
      setSubmitted(true)
    }
  }

  const allAnswered = Object.keys(answers).length === QUIZ_QUESTIONS.length

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">
        🎓 Quick Awareness Check
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Test what you've learned — 3 questions.
      </p>

      {!submitted ? (
        <div className="space-y-5">
          {QUIZ_QUESTIONS.map((q, qi) => (
            <div key={q.id}>
              <p className="text-sm font-medium text-gray-800 mb-2">
                {qi + 1}. {q.text}
              </p>
              <div className="space-y-2">
                {q.options.map(opt => {
                  const selected = answers[q.id] === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => selectAnswer(q.id, opt.key)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                        selected
                          ? 'bg-blue-50 border-blue-400 text-blue-800 font-medium'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50/50'
                      }`}
                    >
                      <span className="font-medium mr-2">{opt.key.toUpperCase()}.</span>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <button
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Quiz'}
          </button>
          {!allAnswered && (
            <p className="text-xs text-gray-400 text-center">
              Answer all 3 questions to submit.
            </p>
          )}
        </div>
      ) : (
        <div className={`rounded-xl p-5 border ${score === 3 ? 'bg-green-50 border-green-200' : score >= 2 ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <p className={`text-lg font-bold mb-1 ${score === 3 ? 'text-green-800' : score >= 2 ? 'text-blue-800' : 'text-yellow-800'}`}>
            You got {score}/3 correct
          </p>
          <p className={`text-sm mb-4 ${score === 3 ? 'text-green-700' : score >= 2 ? 'text-blue-700' : 'text-yellow-700'}`}>
            {score === 3
              ? 'Excellent! You have a strong understanding of phishing red flags.'
              : score >= 2
              ? 'Good effort. Review the questions you missed to sharpen your awareness.'
              : 'Keep learning — phishing attacks are getting more sophisticated. Review the tips above.'}
          </p>

          {/* Show correct answers */}
          <div className="space-y-2">
            {QUIZ_QUESTIONS.map((q, qi) => {
              const userAnswer = answers[q.id]
              const isCorrect = userAnswer === q.correct
              const correctLabel = q.options.find(o => o.key === q.correct)?.label
              return (
                <div key={q.id} className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  <span className="font-bold flex-shrink-0">{isCorrect ? '✓' : '✗'}</span>
                  <span>
                    <span className="font-medium">Q{qi + 1}:</span>{' '}
                    {isCorrect ? 'Correct' : `Correct answer: ${q.correct.toUpperCase()}. ${correctLabel}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main PhishPage component ──────────────────────────────────
export default function PhishPage() {
  const { uuid } = useParams()
  const [phase, setPhase] = useState('loading') // loading | form | transitioning | awareness | error
  const [context, setContext] = useState(null)
  const [formData, setFormData] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    phishApi.getContext(uuid)
      .then(data => {
        setContext(data)
        setPhase(data.already_submitted ? 'awareness' : 'form')
      })
      .catch(() => setPhase('error'))
  }, [uuid])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await phishApi.submitCreds(uuid)
    } catch {}
    setPhase('transitioning')
    setSubmitting(false)

    let c = 3
    const interval = setInterval(() => {
      c -= 1
      setCountdown(c)
      if (c <= 0) {
        clearInterval(interval)
        setPhase('awareness')
      }
    }, 1000)
  }

  // ── Loading ──────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-sm">This link is no longer valid.</p>
        </div>
      </div>
    )
  }

  // ── Transitioning ────────────────────────────────────────
  if (phase === 'transitioning') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-gray-700 font-medium">Redirecting in {countdown}...</p>
        </div>
      </div>
    )
  }

  // ── Awareness screen (with quiz below) ───────────────────
  if (phase === 'awareness') {
    const redFlags = context?.red_flags || []
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          {/* Header */}
          <div className="bg-amber-500 rounded-t-2xl px-6 py-5 text-center">
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">Phishing Simulation</h1>
            <p className="text-amber-100 text-sm mt-1">Security Awareness Training</p>
          </div>

          {/* Body */}
          <div className="bg-white rounded-b-2xl px-6 py-6 shadow-2xl">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5">
              <p className="text-green-800 font-semibold text-sm mb-1">
                ✓ Your credentials were NOT captured
              </p>
              <p className="text-green-700 text-sm">
                This was a simulated phishing test run by your security team.
                No real data was stored or transmitted.
              </p>
            </div>

            <h2 className="text-base font-semibold text-gray-900 mb-3">
              🚩 Red flags in this email
            </h2>
            <div className="space-y-3 mb-5">
              {redFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-lg p-3">
                  <div className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-red-600 text-xs font-bold">{i + 1}</span>
                  </div>
                  <p className="text-sm text-red-800">{flag}</p>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">What to do next time:</h3>
              <ul className="space-y-1.5 text-sm text-blue-800">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">→</span>
                  Hover over links before clicking to verify the destination URL
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">→</span>
                  Verify the sender's email domain matches your company's official domain
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">→</span>
                  When in doubt, contact the sender through a known, trusted channel
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">→</span>
                  Report suspicious emails to your IT security team immediately
                </li>
              </ul>
            </div>

            {/* Quiz — shown below the awareness content */}
            <AwarenessQuiz uuid={uuid} />

            <div className="text-center mt-6">
              <p className="text-xs text-gray-400">
                Authorized simulation · {context?.org_name} Security Team
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Fake login form ──────────────────────────────────────
  const scenarioConfig = {
    'IT Support': { logo: '🖥️', title: 'IT Helpdesk Portal', subtitle: 'Verify your identity to continue' },
    'HR': { logo: '👥', title: 'HR Self-Service Portal', subtitle: 'Sign in to access your HR documents' },
    'Finance': { logo: '💳', title: 'Finance Approval System', subtitle: 'Authentication required' },
    'CEO Fraud': { logo: '📧', title: 'Secure Message Portal', subtitle: 'You have a confidential message' },
    'Vendor': { logo: '📦', title: 'Vendor Portal', subtitle: 'Sign in to view your invoice' },
  }
  const config = scenarioConfig[context?.scenario_type] || scenarioConfig['IT Support']

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gray-800 px-6 py-5 text-center">
            <div className="text-3xl mb-2">{config.logo}</div>
            <h1 className="text-white font-semibold text-lg">{config.title}</h1>
            <p className="text-gray-400 text-sm mt-0.5">{config.subtitle}</p>
          </div>
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email or Username</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@company.com"
                value={formData.username}
                onChange={e => setFormData(f => ({ ...f, username: e.target.value }))}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                value={formData.password}
                onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <div className="px-6 pb-4 text-center">
            <p className="text-xs text-gray-400">
              Secured by {context?.org_name || 'Your Organization'} IT
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
