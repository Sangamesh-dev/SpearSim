import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../components/AuthProvider.jsx'
import { campaignApi, orgApi, employeeApi, gdprApi, downloadBlob } from '../lib/api.js'
import LoadingSpinner from '../components/LoadingSpinner.jsx'

const SCENARIOS = ['IT Support', 'HR', 'Finance', 'CEO Fraud', 'Vendor']
const DIFFICULTIES = ['Low', 'Medium', 'High']
const LAWFUL_BASES = ['Legitimate Interest', 'Employee Contract', 'Legal Obligation']

const DIFFICULTY_DESC = {
  Low: 'Obvious red flags — generic greeting, suspicious domain, poor grammar.',
  Medium: 'Moderate sophistication — plausible sender, subtle URL mismatch.',
  High: 'High sophistication — personalised, convincing, minimal red flags.',
}

export default function NewCampaign() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [orgs, setOrgs] = useState([])
  const [form, setForm] = useState({
    name: '',
    org_id: '',
    scenario_type: 'IT Support',
    difficulty: 'Medium',
    notes: '',
  })
  const [campaign, setCampaign] = useState(null)

  // Create org modal
  const [orgModalOpen, setOrgModalOpen] = useState(false)
  const [orgForm, setOrgForm] = useState({ name: '', domain: '' })
  const [orgCreating, setOrgCreating] = useState(false)

  // Step 2
  const [uploadResult, setUploadResult] = useState(null)
  const [uploading, setUploading] = useState(false)

  // Step 3
  const [consent, setConsent] = useState({
    lawful_basis: 'Legitimate Interest',
    consent_signed: false,
    admin_confirms_authority: false,
  })
  const [pdfDownloaded, setPdfDownloaded] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [pollingTask, setPollingTask] = useState(null)

  useEffect(() => {
    orgApi.list().then(setOrgs)
  }, [])

  useEffect(() => {
    if (!pollingTask) return
    const interval = setInterval(async () => {
      try {
        const res = await campaignApi.getTaskStatus(pollingTask.campaignId, pollingTask.taskId)
        if (res.state === 'SUCCESS') {
          toast.success('All campaign emails sent successfully!')
          setPollingTask(null)
          setLaunching(false)
          navigate(`/campaigns/${pollingTask.campaignId}`)
        } else if (res.state === 'FAILURE') {
          toast.error(`Failed to send campaign emails: ${res.result || 'Unknown error'}`)
          setPollingTask(null)
          setLaunching(false)
        }
      } catch (err) {
        console.error('Failed to poll task status', err)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [pollingTask, navigate])

  // ── Create org modal ─────────────────────────────────────
  async function handleCreateOrg(e) {
    e.preventDefault()
    const domain = orgForm.domain.trim().toLowerCase().replace(/^@/, '')
    if (!orgForm.name.trim() || !domain) return
    setOrgCreating(true)
    try {
      const created = await orgApi.create({ name: orgForm.name.trim(), domain })
      const refreshed = await orgApi.list()
      setOrgs(refreshed)
      setForm(f => ({ ...f, org_id: created.id }))
      setOrgModalOpen(false)
      setOrgForm({ name: '', domain: '' })
      toast.success('Organization created')
    } finally {
      setOrgCreating(false)
    }
  }
  async function handleCreateCampaign(e) {
    e.preventDefault()
    if (!form.org_id) { toast.error('Select an organization'); return }
    setLoading(true)
    try {
      const payload = { ...form, created_by: user.email }
      const c = await campaignApi.create(payload)
      setCampaign(c)
      setStep(2)
      toast.success('Campaign created')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: Upload CSV ───────────────────────────────────
  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await employeeApi.uploadCsv(campaign.id, file)
      setUploadResult(result)
      if (result.loaded > 0) toast.success(`${result.loaded} employees loaded`)
      if (result.rejected > 0) toast.error(`${result.rejected} rows rejected (domain mismatch)`)
    } finally {
      setUploading(false)
    }
  }

  // ── Step 3: Download consent PDF ────────────────────────
  async function handleDownloadPdf() {
    setLoading(true)
    try {
      const blob = await gdprApi.generateConsentPdf(campaign.id, {
        campaign_id: campaign.id,
        admin_email: user.email,
        lawful_basis: consent.lawful_basis,
        org_name: orgs.find(o => o.id === form.org_id)?.name || 'Organization',
        campaign_name: form.name,
        campaign_scope: `${form.scenario_type} simulation targeting ${uploadResult?.loaded || 0} employees`,
      })
      downloadBlob(blob, `phishsim-authorization-${campaign.id.slice(0, 8)}.pdf`)
      setPdfDownloaded(true)
      toast.success('Authorization PDF downloaded')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3: Save consent + launch ───────────────────────
  async function handleLaunch() {
    if (!pdfDownloaded) { toast.error('Download the authorization PDF first'); return }
    if (!consent.consent_signed) { toast.error('Check the consent checkbox'); return }
    if (!consent.admin_confirms_authority) { toast.error('Confirm you have authority to run this simulation'); return }

    setLaunching(true)
    try {
      await campaignApi.updateConsent(campaign.id, consent)
      const res = await campaignApi.launch(campaign.id)
      if (res?.status === 'queued' && res.task_id) {
        setPollingTask({ campaignId: campaign.id, taskId: res.task_id })
        toast.success('Campaign emails are being sent in the background...')
      } else {
        toast.success('Campaign launched! Emails are being sent.')
        setLaunching(false)
        navigate(`/campaigns/${campaign.id}`)
      }
    } catch (err) {
      setLaunching(false)
    }
  }

  return (
    <>
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">New Campaign</h1>
        <p className="text-slate-400 text-sm mt-1">Set up a phishing simulation in 3 steps</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 ${s <= step ? 'text-blue-400' : 'text-slate-600'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                s < step ? 'bg-blue-600 border-blue-600 text-white' :
                s === step ? 'border-blue-500 text-blue-400' :
                'border-slate-700 text-slate-600'
              }`}>
                {s < step ? '✓' : s}
              </div>
              <span className="text-sm font-medium hidden sm:block">
                {s === 1 ? 'Setup' : s === 2 ? 'Employees' : 'Consent & Launch'}
              </span>
            </div>
            {s < 3 && <div className={`flex-1 h-px ${s < step ? 'bg-blue-600' : 'bg-slate-800'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* ── STEP 1 ── */}
      {step === 1 && (
        <form onSubmit={handleCreateCampaign} className="card space-y-5">
          <h2 className="text-base font-semibold text-white">Campaign Setup</h2>

          <div>
            <label className="label">Campaign Name</label>
            <input
              className="input"
              placeholder="e.g. Q3 IT Support Simulation"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="label">Notes <span className="text-slate-600 font-normal">(optional)</span></label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="Internal notes about this campaign e.g. Q3 board test, targeting finance team"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Organization</label>
              <button
                type="button"
                className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1"
                onClick={() => setOrgModalOpen(true)}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Organization
              </button>
            </div>
            <select
              className="input"
              value={form.org_id}
              onChange={e => setForm(f => ({ ...f, org_id: e.target.value }))}
              required
            >
              <option value="">Select organization...</option>
              {orgs.map(o => (
                <option key={o.id} value={o.id}>{o.name} ({o.domain})</option>
              ))}
            </select>
            {orgs.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                No organizations yet — click <strong className="text-slate-400">New Organization</strong> to create one.
              </p>
            )}
          </div>

          <div>
            <label className="label">Scenario Type</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {SCENARIOS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, scenario_type: s }))}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    form.scenario_type === s
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Difficulty</label>
            <div className="grid grid-cols-3 gap-3">
              {DIFFICULTIES.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                  className={`p-3 rounded-lg text-left border transition-colors ${
                    form.difficulty === d
                      ? 'bg-blue-600/20 border-blue-500'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <p className={`text-sm font-medium ${form.difficulty === d ? 'text-blue-400' : 'text-slate-300'}`}>{d}</p>
                  <p className="text-xs text-slate-500 mt-1">{DIFFICULTY_DESC[d]}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Continue →'}
            </button>
          </div>
        </form>
      )}

      {/* ── STEP 2 ── */}
      {step === 2 && (
        <div className="card space-y-5">
          <h2 className="text-base font-semibold text-white">Upload Employees</h2>
          <p className="text-sm text-slate-400">
            CSV format: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs">email, role[, name]</code>.
            Only emails matching <strong className="text-slate-300">{orgs.find(o => o.id === form.org_id)?.domain}</strong> will be accepted.
          </p>
          <p className="text-xs text-slate-500">
            Optional: add a <code className="bg-slate-800 px-1 py-0.5 rounded">scenario</code> column to assign different phishing scenarios per employee.
            Valid values: <span className="text-slate-400">IT Support, HR, Finance, CEO Fraud, Vendor</span>
          </p>

          <div
            className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-600/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
            {uploading ? (
              <LoadingSpinner size="sm" label="Processing CSV..." />
            ) : (
              <>
                <svg className="w-10 h-10 text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-slate-400 text-sm">Click to upload CSV</p>
                <p className="text-slate-600 text-xs mt-1">email, role (required) — name (optional)</p>
              </>
            )}
          </div>

          {uploadResult && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 bg-green-900/20 border border-green-800/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">{uploadResult.loaded}</p>
                  <p className="text-xs text-green-600 mt-0.5">Loaded</p>
                </div>
                <div className="flex-1 bg-red-900/20 border border-red-800/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{uploadResult.rejected}</p>
                  <p className="text-xs text-red-600 mt-0.5">Rejected</p>
                </div>
              </div>

              {uploadResult.rejected_emails.length > 0 && (
                <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-400 mb-1">Rejected (domain mismatch):</p>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {uploadResult.rejected_emails.map(e => (
                      <p key={e} className="text-xs text-red-300/70">{e}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">Employee preview (pseudonymised):</p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-slate-400">Alias</th>
                        <th className="text-left px-3 py-2 text-slate-400">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.preview.map((emp, i) => (
                        <tr key={i} className="border-t border-slate-800/50">
                          <td className="px-3 py-2 text-slate-300 font-mono">{emp.alias}</td>
                          <td className="px-3 py-2 text-slate-400">{emp.role_generic}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button
              className="btn-primary"
              disabled={!uploadResult || uploadResult.loaded === 0}
              onClick={() => setStep(3)}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3 ── */}
      {step === 3 && (
        <div className="card space-y-5">
          <h2 className="text-base font-semibold text-white">GDPR Consent Gate</h2>
          <p className="text-sm text-slate-400">
            Before launching, you must confirm lawful basis and download the authorization document.
          </p>

          <div>
            <label className="label">Lawful Basis (GDPR Article 6)</label>
            <select
              className="input"
              value={consent.lawful_basis}
              onChange={e => setConsent(c => ({ ...c, lawful_basis: e.target.value }))}
            >
              {LAWFUL_BASES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                checked={consent.admin_confirms_authority}
                onChange={e => setConsent(c => ({ ...c, admin_confirms_authority: e.target.checked }))}
              />
              <span className="text-sm text-slate-300">
                I confirm that I have the authority to conduct this phishing simulation on behalf of my organization,
                and that this simulation is conducted solely for security awareness training purposes.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                checked={consent.consent_signed}
                onChange={e => setConsent(c => ({ ...c, consent_signed: e.target.checked }))}
              />
              <span className="text-sm text-slate-300">
                I have read and agree to the data processing terms. Employee data will be pseudonymised,
                retained for 90 days, and processed under the selected lawful basis.
              </span>
            </label>
          </div>

          <button
            className="btn-secondary w-full flex items-center justify-center gap-2"
            onClick={handleDownloadPdf}
            disabled={loading}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {loading ? 'Generating...' : 'Download Authorization PDF'}
            {pdfDownloaded && <span className="text-green-400 text-xs">✓ Downloaded</span>}
          </button>

          {!pdfDownloaded && (
            <p className="text-xs text-yellow-400 text-center">
              You must download the authorization PDF before launching.
            </p>
          )}

          {pollingTask && (
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-xl p-4 flex items-center gap-4 text-blue-300">
              <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm font-medium">Emails are being sent in the background. Please keep this page open...</p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button className="btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button
              className="btn-primary flex items-center gap-2"
              disabled={!pdfDownloaded || !consent.consent_signed || !consent.admin_confirms_authority || launching}
              onClick={handleLaunch}
            >
              {launching ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Launch Campaign
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* ── CREATE ORGANIZATION MODAL ── */}
    {orgModalOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-modal-title"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => { setOrgModalOpen(false); setOrgForm({ name: '', domain: '' }) }}
        />

        {/* Panel */}
        <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <h2 id="org-modal-title" className="text-base font-semibold text-white">
              New Organization
            </h2>
            <button
              type="button"
              className="text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => { setOrgModalOpen(false); setOrgForm({ name: '', domain: '' }) }}
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleCreateOrg} className="px-6 py-5 space-y-4">
            <div>
              <label className="label" htmlFor="org-name">Organization Name</label>
              <input
                id="org-name"
                className="input"
                placeholder="e.g. Acme Corp"
                value={orgForm.name}
                onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="label" htmlFor="org-domain">Domain</label>
              <input
                id="org-domain"
                className="input"
                placeholder="e.g. ncirl.ie"
                value={orgForm.domain}
                onChange={e => setOrgForm(f => ({ ...f, domain: e.target.value.replace(/^@/, '') }))}
                required
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Just the domain — no @ symbol. Employees must have emails ending in this domain.
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setOrgModalOpen(false); setOrgForm({ name: '', domain: '' }) }}
                disabled={orgCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={orgCreating || !orgForm.name.trim() || !orgForm.domain.trim()}
              >
                {orgCreating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Organization'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>
  )
}
