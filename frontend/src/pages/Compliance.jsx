import React, { useEffect, useState } from 'react'
import { gdprApi, downloadBlob } from '../lib/api.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import toast from 'react-hot-toast'
import { formatDistanceToNow, format } from 'date-fns'

const ACTION_FILTERS = [
  '', 'CAMPAIGN', 'CSV', 'GDPR', 'REPORT', 'USER', 'RETENTION'
]

export default function Compliance() {
  const [tab, setTab] = useState('retention')
  const [campaigns, setCampaigns] = useState([])
  const [auditLogs, setAuditLogs] = useState({ items: [], total: 0, page: 1, page_size: 50 })
  const [loading, setLoading] = useState(false)
  const [auditPage, setAuditPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [erasureAlias, setErasureAlias] = useState('')
  const [erasureEmail, setErasureEmail] = useState('admin@company.com')
  const [erasureResult, setErasureResult] = useState(null)
  const [erasing, setErasing] = useState(false)

  useEffect(() => {
    if (tab === 'retention') {
      setLoading(true)
      gdprApi.getActiveCampaigns().then(setCampaigns).finally(() => setLoading(false))
    }
    if (tab === 'audit') {
      setLoading(true)
      gdprApi.getAuditLogs(auditPage, 50, actionFilter)
        .then(setAuditLogs)
        .finally(() => setLoading(false))
    }
  }, [tab, auditPage, actionFilter])

  async function handleErasure(e) {
    e.preventDefault()
    if (!erasureAlias.trim()) { toast.error('Enter an employee alias'); return }
    setErasing(true)
    try {
      const result = await gdprApi.eraseEmployee(erasureAlias.trim(), erasureEmail)
      setErasureResult(result)
      toast.success(`Employee ${erasureAlias} erased successfully`)
    } finally {
      setErasing(false)
    }
  }

  async function handleDownloadReceipt() {
    if (!erasureResult) return
    try {
      const blob = await gdprApi.downloadErasureReceipt(
        erasureResult.alias,
        erasureEmail,
        'unknown'
      )
      downloadBlob(blob, `erasure-receipt-${erasureResult.alias}.pdf`)
      toast.success('Erasure receipt downloaded')
    } catch {}
  }

  const tabs = [
    { id: 'retention', label: 'Data Retention' },
    { id: 'erasure', label: 'Right to Erasure' },
    { id: 'audit', label: 'Audit Log' },
  ]

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Compliance</h1>
        <p className="text-slate-400 text-sm mt-1">GDPR compliance dashboard — Article 5, 17, and 30</p>
      </div>

      {/* GDPR badges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Pseudonymisation', desc: 'Article 5', color: 'green' },
          { label: 'Consent Gate', desc: 'Article 6', color: 'green' },
          { label: '90-Day Retention', desc: 'Article 5(1)(e)', color: 'green' },
          { label: 'Right to Erasure', desc: 'Article 17', color: 'green' },
        ].map(b => (
          <div key={b.label} className="bg-green-900/10 border border-green-800/30 rounded-lg p-3 flex items-center gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-green-400">{b.label}</p>
              <p className="text-xs text-green-700">{b.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── RETENTION TAB ── */}
      {tab === 'retention' && (
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Active Campaign Retention</h2>
          <p className="text-sm text-slate-400 mb-4">
            All campaign data is automatically deleted after 90 days (GDPR Article 5(1)(e)).
          </p>
          {loading ? (
            <LoadingSpinner label="Loading campaigns..." />
          ) : campaigns.length === 0 ? (
            <EmptyState title="No active campaigns" description="Active campaigns will appear here with their retention countdown." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Campaign</th>
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Organization</th>
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Status</th>
                    <th className="text-right py-3 px-4 text-slate-400 font-medium">Employees</th>
                    <th className="text-right py-3 px-4 text-slate-400 font-medium">Delete At</th>
                    <th className="text-right py-3 px-4 text-slate-400 font-medium">Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => {
                    const days = Math.max(0, Math.round(c.retention_days_remaining || 0))
                    return (
                      <tr key={c.id} className="border-b border-slate-800/50">
                        <td className="py-3 px-4 text-white font-medium">{c.name}</td>
                        <td className="py-3 px-4 text-slate-400">{c.org_name}</td>
                        <td className="py-3 px-4">
                          <span className={c.status === 'active' ? 'badge-active' : 'badge-draft'}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">{c.total_employees || 0}</td>
                        <td className="py-3 px-4 text-right text-slate-400 text-xs">
                          {c.auto_delete_at ? format(new Date(c.auto_delete_at), 'MMM d, yyyy') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={
                            days < 7 ? 'text-red-400 font-bold' :
                            days < 30 ? 'text-yellow-400' :
                            'text-slate-400'
                          }>
                            {days}d
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ERASURE TAB ── */}
      {tab === 'erasure' && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-1">Right to Erasure (Article 17)</h2>
            <p className="text-sm text-slate-400 mb-4">
              Enter an employee alias to erase all their simulation data — employee record, events, and name map entry.
            </p>
            <form onSubmit={handleErasure} className="space-y-4">
              <div>
                <label className="label">Employee Alias</label>
                <input
                  className="input font-mono"
                  placeholder="Employee_3F9A"
                  value={erasureAlias}
                  onChange={e => setErasureAlias(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Requesting Admin Email</label>
                <input
                  className="input"
                  type="email"
                  value={erasureEmail}
                  onChange={e => setErasureEmail(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-danger flex items-center gap-2" disabled={erasing}>
                {erasing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Erasing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Erase Employee Data
                  </>
                )}
              </button>
            </form>
          </div>

          {erasureResult && (
            <div className="card border-green-800/50 bg-green-900/10">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-green-400 mb-2">✓ Erasure Complete</h3>
                  <p className="text-sm text-slate-300">
                    Alias: <code className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">{erasureResult.alias}</code>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Erased at: {format(new Date(erasureResult.erased_at), 'PPpp')}
                  </p>
                  <div className="mt-2 space-y-0.5">
                    {Object.entries(erasureResult.records_deleted).map(([table, count]) => (
                      <p key={table} className="text-xs text-slate-400">
                        {table}: <span className="text-slate-300">{count} record(s) deleted</span>
                      </p>
                    ))}
                  </div>
                </div>
                <button
                  className="btn-secondary text-xs flex items-center gap-1.5"
                  onClick={handleDownloadReceipt}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download Receipt
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT LOG TAB ── */}
      {tab === 'audit' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">Audit Log</h2>
              <p className="text-xs text-slate-500 mt-0.5">Read-only — {auditLogs.total} total entries</p>
            </div>
            <select
              className="input w-48 text-sm"
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setAuditPage(1) }}
            >
              <option value="">All actions</option>
              {ACTION_FILTERS.filter(Boolean).map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <LoadingSpinner label="Loading audit logs..." />
          ) : auditLogs.items.length === 0 ? (
            <EmptyState title="No audit entries" description="Actions will be logged here as they occur." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-2.5 px-3 text-slate-400 font-medium">Timestamp</th>
                      <th className="text-left py-2.5 px-3 text-slate-400 font-medium">Actor</th>
                      <th className="text-left py-2.5 px-3 text-slate-400 font-medium">Action</th>
                      <th className="text-left py-2.5 px-3 text-slate-400 font-medium">Target</th>
                      <th className="text-left py-2.5 px-3 text-slate-400 font-medium">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.items.map(log => (
                      <tr key={log.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                        <td className="py-2.5 px-3 text-slate-500 font-mono whitespace-nowrap">
                          {format(new Date(log.timestamp), 'MM/dd HH:mm:ss')}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{log.actor_email}</td>
                        <td className="py-2.5 px-3">
                          <span className={`font-mono px-1.5 py-0.5 rounded text-xs ${
                            log.action.includes('DELETE') || log.action.includes('ERASE')
                              ? 'bg-red-900/30 text-red-400'
                              : log.action.includes('LAUNCH') || log.action.includes('CREATE')
                              ? 'bg-blue-900/30 text-blue-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {log.target_table && `${log.target_table}${log.target_id ? ` / ${log.target_id.slice(0, 8)}` : ''}`}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-mono">{log.ip_address}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800">
                <p className="text-xs text-slate-500">
                  Page {auditLogs.page} · {auditLogs.total} total entries
                </p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs px-3 py-1.5"
                    disabled={auditPage === 1}
                    onClick={() => setAuditPage(p => p - 1)}
                  >
                    ← Prev
                  </button>
                  <button
                    className="btn-secondary text-xs px-3 py-1.5"
                    disabled={auditPage * auditLogs.page_size >= auditLogs.total}
                    onClick={() => setAuditPage(p => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
