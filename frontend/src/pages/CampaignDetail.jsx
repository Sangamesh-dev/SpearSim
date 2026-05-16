import React, { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { campaignApi, employeeApi, downloadBlob } from '../lib/api.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import StatCard from '../components/StatCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { supabase } from '../lib/auth.js'

export default function CampaignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(false)
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [sortField, setSortField] = useState('alias')
  const [sortDir, setSortDir] = useState('asc')
  const [completing, setCompleting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [resending, setResending] = useState(false)
  const [employees, setEmployees] = useState([])
  const [empLoading, setEmpLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Realtime Live Tracking State
  const [liveEvents, setLiveEvents] = useState([])
  const [liveCounts, setLiveCounts] = useState({ opens: 0, clicks: 0, creds: 0 })
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    campaignApi.get(id)
      .then(setCampaign)
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (campaign?.status !== 'active') return
    setIsLive(true)
    const channel = supabase
      .channel(`campaign-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
        filter: `campaign_id=eq.${id}`
      }, (payload) => {
        const ev = payload.new
        setLiveEvents(prev => [ev, ...prev].slice(0, 20))
        setLiveCounts(prev => ({
          ...prev,
          opens: prev.opens + (ev.event_type === 'open' ? 1 : 0),
          clicks: prev.clicks + (ev.event_type === 'click' ? 1 : 0),
          creds: prev.creds + (ev.event_type === 'cred_entered' ? 1 : 0),
        }))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [campaign?.status, id])

  useEffect(() => {
    const status = campaign?.status
    if (status === 'active' || status === 'completed') {
      // Only fetch if we don't already have a report for this campaign
      if (!report) {
        setReportLoading(true)
        campaignApi.getReport(id)
          .then(setReport)
          .finally(() => setReportLoading(false))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.id, campaign?.status])

  useEffect(() => {
    if (campaign?.status === 'draft') {
      setEmpLoading(true)
      employeeApi.list(id).then(setEmployees).finally(() => setEmpLoading(false))
    }
  }, [campaign?.status, id])

  function toggleRow(alias) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(alias) ? next.delete(alias) : next.add(alias)
      return next
    })
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      await campaignApi.complete(id)
      toast.success('Campaign marked as completed')
      setCampaign(c => ({ ...c, status: 'completed' }))
    } finally {
      setCompleting(false)
    }
  }

  async function handleDownloadPdf() {
    setDownloading(true)
    try {
      const blob = await campaignApi.downloadReportPdf(id)
      downloadBlob(blob, `phishsim-report-${id.slice(0, 8)}.pdf`)
      toast.success('Report PDF downloaded')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadCsv() {
    try {
      const blob = await campaignApi.downloadReportCsv(id)
      downloadBlob(blob, `phishsim-report-${id.slice(0, 8)}.csv`)
      toast.success('Report CSV downloaded')
    } catch {}
  }

  async function handleResend() {
    setResending(true)
    try {
      const result = await campaignApi.resend(id)
      toast.success(result.message)
    } finally {
      setResending(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await campaignApi.delete(id)
      toast.success('Campaign deleted')
      navigate('/dashboard')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handlePreview() {
    setPreviewLoading(true)
    setShowPreview(true)
    try {
      const data = await campaignApi.previewEmail(id)
      setPreview(data)
    } catch {
      setShowPreview(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handlePreviewLaunch() {
    setShowPreview(false)
    setPreview(null)
    // Trigger the existing launch flow via the consent step
    // The campaign must already have consent signed to reach this point
    try {
      const result = await campaignApi.launch(id)
      toast.success(result.message)
      setCampaign(c => ({ ...c, status: 'active' }))
    } catch {}
  }

  if (loading) return <div className="p-8"><LoadingSpinner label="Loading campaign..." /></div>
  if (!campaign) return (
    <div className="p-8">
      <EmptyState title="Campaign not found" description="This campaign may have been deleted." />
    </div>
  )

  const sortedEmployees = report ? [...report.employees].sort((a, b) => {
    let av = a[sortField], bv = b[sortField]
    if (typeof av === 'boolean') av = av ? 1 : 0
    if (typeof bv === 'boolean') bv = bv ? 1 : 0
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  }) : []

  const chartData = report ? [
    { name: 'Opened', value: report.open_rate, fill: '#3b82f6' },
    { name: 'Clicked', value: report.click_rate, fill: '#f59e0b' },
    { name: 'Creds', value: report.cred_rate, fill: '#ef4444' },
    { name: 'Benchmark', value: report.industry_benchmark, fill: '#64748b' },
  ] : []

  const SortIcon = ({ field }) => (
    <span className="ml-1 text-slate-600">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <>
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link to="/dashboard" className="text-slate-500 hover:text-slate-300 text-sm">← Dashboard</Link>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge status={campaign.status} />
            <span className="text-slate-500 text-sm">{campaign.scenario_type}</span>
            <span className="text-slate-500 text-sm">·</span>
            <span className="text-slate-500 text-sm">{campaign.difficulty}</span>
            <span className="text-slate-500 text-sm">·</span>
            <span className="text-slate-500 text-sm">{campaign.org_name}</span>
          </div>
          {campaign.notes && (
            <p className="text-slate-500 text-sm mt-2 italic">"{campaign.notes}"</p>
          )}
        </div>
        <div className="flex gap-2">
          {(campaign.status === 'draft' || campaign.status === 'completed') && (
            <>
              {!showDeleteConfirm ? (
                <button
                  className="btn-secondary text-red-400 border-red-900/50 hover:border-red-700"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-red-300">Are you sure?</span>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 font-medium"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button
                    className="text-xs text-slate-400 hover:text-slate-300"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {campaign.status === 'active' && (
            <button
              className="btn-secondary flex items-center gap-1.5"
              onClick={handleResend}
              disabled={resending}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {resending ? 'Sending...' : 'Resend Emails'}
            </button>
          )}
          {campaign.status === 'active' && (
            <button className="btn-secondary" onClick={handleComplete} disabled={completing}>
              {completing ? 'Completing...' : 'Mark Complete'}
            </button>
          )}
          {report && (
            <>
              <button className="btn-secondary flex items-center gap-1.5" onClick={handleDownloadCsv}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                CSV
              </button>
              <button className="btn-primary flex items-center gap-1.5" onClick={handleDownloadPdf} disabled={downloading}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {downloading ? 'Generating...' : 'PDF Report'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Retention warning */}
      {campaign.retention_days_remaining !== null && campaign.retention_days_remaining < 14 && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-red-300">
            <strong>Data retention warning:</strong> This campaign's data will be automatically deleted in{' '}
            <strong>{Math.round(campaign.retention_days_remaining)} days</strong> (GDPR Article 5(1)(e)).
            Export your report now.
          </p>
        </div>
      )}

      {/* Live counters bar */}
      {isLive && (
        <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-4 flex items-center justify-between text-emerald-300">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping flex-shrink-0" />
            <span className="text-sm font-medium">Live Stream Active:</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-semibold">
            <span>{liveCounts.opens} opens</span>
            <span>·</span>
            <span>{liveCounts.clicks} clicks</span>
            <span>·</span>
            <span>{liveCounts.creds} creds</span>
            <span className="text-xs text-emerald-500 font-normal hidden sm:inline">(this session)</span>
          </div>
        </div>
      )}

      {/* Live Activity Feed */}
      {isLive && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Recent Activity (live)</h2>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <span className="text-xs text-slate-500">Showing last 20 live events</span>
          </div>
          {liveEvents.length === 0 ? (
            <div className="py-8 text-center">
              <div className="w-8 h-8 border-2 border-slate-800 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-slate-400">Waiting for activity...</p>
              <p className="text-xs text-slate-600 mt-1">Actions taken by employees will appear here instantly</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-2">
              {liveEvents.map((ev) => {
                let icon, text, color;
                if (ev.event_type === 'open') {
                  icon = (
                    <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  );
                  text = "opened the email";
                  color = "border-blue-900/50 bg-blue-950/20";
                } else if (ev.event_type === 'click') {
                  icon = (
                    <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                  );
                  text = "clicked the phishing link";
                  color = "border-yellow-900/50 bg-yellow-950/20";
                } else {
                  icon = (
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  );
                  text = "submitted credentials";
                  color = "border-red-900/50 bg-red-950/20";
                }
                return (
                  <div key={ev.id || Math.random()} className={`live-event flex items-center justify-between p-3 rounded-lg border ${color}`}>
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-md bg-slate-900/80">
                        {icon}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-200">
                          An employee <span className="font-normal text-slate-400">{text}</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {report && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Targeted" value={report.total_targeted} color="slate" />
          <StatCard label="Opened" value={`${report.total_opened} (${report.open_rate}%)`} color="blue" />
          <StatCard
            label="Clicked"
            value={`${report.total_clicked} (${report.click_rate}%)`}
            sub={`Benchmark: ${report.industry_benchmark}%`}
            color={report.click_rate > report.industry_benchmark ? 'red' : 'yellow'}
          />
          <StatCard
            label="Risk Score"
            value={`${report.risk_score}%`}
            sub={report.risk_score > report.industry_benchmark ? 'Above benchmark' : 'Below benchmark'}
            color={report.risk_score > report.industry_benchmark ? 'red' : 'green'}
          />
        </div>
      )}

      {/* Quiz stats */}
      {report && (report.quiz_completion_rate > 0 || report.quiz_avg_score > 0) && (
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Quiz Completion"
            value={`${report.quiz_completion_rate}%`}
            sub="Employees who completed the quiz"
            color="blue"
          />
          <StatCard
            label="Quiz Avg Score"
            value={`${report.quiz_avg_score} / 3`}
            sub="Average correct answers"
            color={report.quiz_avg_score >= 2 ? 'green' : 'yellow'}
          />
        </div>
      )}

      {/* Chart */}
      {report && (
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Engagement Rates</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }}
                formatter={(v) => [`${v}%`]}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Employee table */}
      {campaign.status === 'draft' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">Uploaded Employees</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{employees.length} loaded</span>
              {employees.length > 0 && (
                <button
                  className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                  onClick={handlePreview}
                  disabled={previewLoading}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {previewLoading ? 'Generating...' : 'Preview Email'}
                </button>
              )}
            </div>
          </div>
          {empLoading ? (
            <LoadingSpinner label="Loading employees..." />
          ) : employees.length === 0 ? (
            <EmptyState
              title="No employees uploaded yet"
              description="Upload a CSV to load employees before launching."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Alias</th>
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Role</th>
                    <th className="text-left py-3 px-4 text-slate-400 font-medium">Scenario</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} className="border-b border-slate-800/50">
                      <td className="py-3 px-4 font-mono text-slate-300 text-xs">{emp.alias}</td>
                      <td className="py-3 px-4 text-slate-400">{emp.role_generic}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          {emp.scenario_override || campaign.scenario_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(campaign.status === 'active' || campaign.status === 'completed') && (
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Employee Breakdown</h2>
          {reportLoading ? (
            <LoadingSpinner label="Generating report..." />
          ) : !report ? (
            <EmptyState title="No report data yet" description="Data will appear as employees interact with the simulation." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    {[
                      { key: 'alias', label: 'Alias' },
                      { key: 'role_generic', label: 'Role' },
                      { key: 'opened', label: 'Opened' },
                      { key: 'clicked', label: 'Clicked' },
                      { key: 'cred_entered', label: 'Creds' },
                      { key: 'risk_level', label: 'Risk' },
                      { key: 'quiz_score', label: 'Quiz' },
                    ].map(col => (
                      <th
                        key={col.key}
                        className="text-left py-3 px-4 text-slate-400 font-medium cursor-pointer hover:text-slate-200 select-none"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}<SortIcon field={col.key} />
                      </th>
                    ))}
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((emp) => (
                    <React.Fragment key={emp.alias}>
                      <tr className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-300 text-xs">{emp.alias}</td>
                        <td className="py-3 px-4 text-slate-400">{emp.role_generic}</td>
                        <td className="py-3 px-4">
                          {emp.opened
                            ? <span className="text-blue-400">✓</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          {emp.clicked
                            ? <span className="text-yellow-400">✓</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          {emp.cred_entered
                            ? <span className="text-red-400">✓</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="py-3 px-4"><RiskBadge level={emp.risk_level} /></td>
                        <td className="py-3 px-4 text-center">
                          {emp.quiz_score != null
                            ? <span className={`text-xs font-medium ${emp.quiz_score >= 2 ? 'text-green-400' : 'text-yellow-400'}`}>{emp.quiz_score}/3</span>
                            : <span className="text-slate-700 text-xs">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          {emp.remediation && (
                            <button
                              className="text-xs text-blue-400 hover:text-blue-300"
                              onClick={() => toggleRow(emp.alias)}
                            >
                              {expandedRows.has(emp.alias) ? 'Hide ↑' : 'Remediation ↓'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedRows.has(emp.alias) && emp.remediation && (
                        <tr className="bg-blue-900/10 border-b border-slate-800/50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div className="w-5 h-5 bg-blue-600/20 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                                <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-blue-400 mb-1">AI Remediation Advice</p>
                                <p className="text-xs text-slate-300 leading-relaxed">{emp.remediation}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>

    {/* ── EMAIL PREVIEW MODAL ── */}
    {showPreview && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setShowPreview(false); setPreview(null) }} />
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
            <div>
              <h2 className="text-base font-semibold text-white">Email Preview</h2>
              <p className="text-xs text-slate-500 mt-0.5">Sample generated for {preview?.to_alias || '…'} — not sent</p>
            </div>
            <button
              className="text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => { setShowPreview(false); setPreview(null) }}
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {previewLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
                <p className="text-sm text-slate-500">Generating preview with AI…</p>
              </div>
            ) : preview ? (
              <>
                <div className="bg-slate-800 rounded-lg px-4 py-3">
                  <p className="text-xs text-slate-500 mb-1">Subject</p>
                  <p className="text-sm font-medium text-white">{preview.subject}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Email Body</p>
                  <iframe
                    srcDoc={preview.body_html}
                    sandbox=""
                    title="Email preview"
                    className="w-full rounded-lg border border-slate-700 bg-white"
                    style={{ height: '380px' }}
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* Footer */}
          {!previewLoading && preview && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 flex-shrink-0">
              <button
                className="btn-secondary"
                onClick={() => { setShowPreview(false); setPreview(null) }}
              >
                ← Go Back
              </button>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={handlePreviewLaunch}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Looks good — Launch
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  )
}
