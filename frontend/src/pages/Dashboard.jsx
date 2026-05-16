import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { campaignApi } from '../lib/api.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import EmptyState from '../components/EmptyState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import StatCard from '../components/StatCard.jsx'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'

export default function Dashboard() {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [backendDown, setBackendDown] = useState(false)

  useEffect(() => {
    setLoading(true)
    campaignApi.list()
      .then(data => {
        setCampaigns(data)
        setBackendDown(false)
      })
      .catch(() => setBackendDown(true))
      .finally(() => setLoading(false))
  }, [lastRefresh])

  useEffect(() => {
    if (!autoRefresh || backendDown) return
    const hasActive = campaigns.some(c => c.status === 'active')
    if (!hasActive) {
      setAutoRefresh(false)
      return
    }
    const interval = setInterval(() => {
      setLastRefresh(new Date())
    }, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, campaigns, backendDown])

  function handleRefresh() {
    setLastRefresh(new Date())
  }

  async function handleDelete(campaignId, e) {
    e.preventDefault()
    e.stopPropagation()
    setDeletingId(campaignId)
    try {
      await campaignApi.delete(campaignId)
      setCampaigns(prev => prev.filter(c => c.id !== campaignId))
      toast.success('Campaign deleted')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredCampaigns = campaigns.filter(c => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.org_name || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    return matchSearch && matchStatus
  })

  const active = campaigns.filter(c => c.status === 'active').length
  const completed = campaigns.filter(c => c.status === 'completed').length
  const totalTargeted = campaigns.reduce((s, c) => s + (c.total_employees || 0), 0)
  const avgRisk = campaigns.length
    ? Math.round(campaigns.reduce((s, c) => {
        const t = c.total_employees || 0
        if (!t) return s
        return s + ((c.total_clicks + c.total_creds) / t * 100)
      }, 0) / campaigns.filter(c => c.total_employees > 0).length || 0)
    : 0

  return (
    <div className="p-8">
      {/* Backend offline banner */}
      {backendDown && (
        <div className="mb-4 bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-2 text-sm text-red-400">
          ⚠ Backend offline — auto-refresh paused. Restart the backend and refresh manually.
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Security awareness campaign overview</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="btn-secondary flex items-center gap-1.5 text-sm"
              disabled={loading}
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-blue-600"
              />
              Auto (30s)
            </label>
          </div>
          <Link to="/campaigns/new" className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Campaign
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Campaigns"
          value={campaigns.length}
          color="slate"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
        />
        <StatCard
          label="Active Campaigns"
          value={active}
          color="blue"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
        />
        <StatCard
          label="Employees Targeted"
          value={totalTargeted.toLocaleString()}
          color="yellow"
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Avg Risk Score"
          value={`${avgRisk}%`}
          sub="Industry avg: 32%"
          color={avgRisk > 40 ? 'red' : avgRisk > 25 ? 'yellow' : 'green'}
          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
        />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            className="input pl-9 text-sm"
            placeholder="Search campaigns..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-40 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
        {(search || statusFilter !== 'all') && (
          <button
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => { setSearch(''); setStatusFilter('all') }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Campaign table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">All Campaigns</h2>
          <span className="text-xs text-slate-500">
            {(search || statusFilter !== 'all')
              ? `Showing ${filteredCampaigns.length} of ${campaigns.length}`
              : `${campaigns.length} total`}
          </span>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading campaigns..." />
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
            title="No campaigns yet"
            description="Create your first phishing simulation campaign to get started."
            action={<Link to="/campaigns/new" className="btn-primary">Create Campaign</Link>}
          />
        ) : filteredCampaigns.length === 0 ? (
          <EmptyState
            icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
            title="No matching campaigns"
            description="Try adjusting your search or status filter."
            action={<button className="btn-secondary text-sm" onClick={() => { setSearch(''); setStatusFilter('all') }}>Clear filters</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Campaign</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Organization</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Scenario</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Status</th>
                  <th className="text-right py-3 px-4 text-slate-400 font-medium">Targeted</th>
                  <th className="text-right py-3 px-4 text-slate-400 font-medium">Click Rate</th>
                  <th className="text-right py-3 px-4 text-slate-400 font-medium">Retention</th>
                  <th className="text-right py-3 px-4 text-slate-400 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((c) => {
                  const clickRate = c.total_employees
                    ? Math.round((c.total_clicks / c.total_employees) * 100)
                    : 0
                  const retentionDays = Math.max(0, Math.round(c.retention_days_remaining || 0))
                  return (
                    <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-medium text-white">{c.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{c.org_name}</td>
                      <td className="py-3 px-4 text-slate-300">{c.scenario_type}</td>
                      <td className="py-3 px-4"><StatusBadge status={c.status} /></td>
                      <td className="py-3 px-4 text-right text-slate-300">{c.total_employees || 0}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={clickRate > 32 ? 'text-red-400' : clickRate > 15 ? 'text-yellow-400' : 'text-green-400'}>
                          {clickRate}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={retentionDays < 14 ? 'text-red-400' : retentionDays < 30 ? 'text-yellow-400' : 'text-slate-400'}>
                          {retentionDays}d
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          to={`/campaigns/${c.id}`}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                        >
                          View →
                        </Link>
                        <button
                          onClick={(e) => handleDelete(c.id, e)}
                          disabled={deletingId === c.id}
                          className="text-red-500 hover:text-red-400 text-xs font-medium ml-3"
                        >
                          {deletingId === c.id ? '...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
