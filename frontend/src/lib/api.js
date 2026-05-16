/**
 * API client — all requests to the PhishSim FastAPI backend.
 */
import axios from 'axios'
import toast from 'react-hot-toast'
import { supabase } from './auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor — add auth token
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// Response interceptor — surface errors as toasts
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.detail || err.response?.data?.error || err.message || 'Request failed'
    toast.error(msg)
    return Promise.reject(err)
  }
)

// ============================================================
// Organizations
// ============================================================
export const orgApi = {
  list: () => api.get('/organizations/').then(r => r.data),
  create: (data) => api.post('/organizations/', data).then(r => r.data),
  get: (id) => api.get(`/organizations/${id}`).then(r => r.data),
}

// ============================================================
// Campaigns
// ============================================================
export const campaignApi = {
  list: () => api.get('/campaigns/').then(r => r.data),
  get: (id) => api.get(`/campaigns/${id}`).then(r => r.data),
  create: (data) => api.post('/campaigns/create', data).then(r => r.data),
  updateConsent: (id, data) => api.post(`/campaigns/${id}/consent`, data).then(r => r.data),
  launch: (id) => api.post(`/campaigns/${id}/launch`).then(r => r.data),
  complete: (id) => api.post(`/campaigns/${id}/complete`).then(r => r.data),
  resend: (id) => api.post(`/campaigns/${id}/resend`).then(r => r.data),
  delete: (id) => api.delete(`/campaigns/${id}`).then(r => r.data),
  getReport: (id) => api.get(`/campaigns/${id}/report`).then(r => r.data),
  previewEmail: (id) => api.get(`/campaigns/${id}/preview-email`).then(r => r.data),
  downloadReportPdf: (id) => api.get(`/campaigns/${id}/report/pdf`, { responseType: 'blob' }).then(r => r.data),
  downloadReportCsv: (id) => api.get(`/campaigns/${id}/report/csv`, { responseType: 'blob' }).then(r => r.data),
  getTaskStatus: (campaignId, taskId) => api.get(`/campaigns/${campaignId}/task-status/${taskId}`).then(r => r.data),
}

// ============================================================
// Employees
// ============================================================
export const employeeApi = {
  list: (campaignId) => api.get(`/employees/${campaignId}`).then(r => r.data),
  uploadCsv: (campaignId, file) => {
    const form = new FormData()
    form.append('campaign_id', campaignId)
    form.append('file', file)
    return api.post('/employees/upload-csv', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}

// ============================================================
// GDPR
// ============================================================
export const gdprApi = {
  eraseEmployee: (alias, actorEmail) =>
    api.delete(`/gdpr/erase/${alias}`, { params: { actor_email: actorEmail } }).then(r => r.data),
  getAuditLogs: (page = 1, pageSize = 50, actionFilter = '') =>
    api.get('/gdpr/audit-logs', {
      params: { page, page_size: pageSize, action_filter: actionFilter || undefined },
    }).then(r => r.data),
  generateConsentPdf: (campaignId, data) =>
    api.post(`/gdpr/consent-pdf/${campaignId}`, data, { responseType: 'blob' }).then(r => r.data),
  getActiveCampaigns: () => api.get('/gdpr/active-campaigns').then(r => r.data),
  downloadErasureReceipt: (alias, actorEmail, campaignId) =>
    api.get(`/gdpr/erase/${alias}/receipt`, {
      params: { actor_email: actorEmail, campaign_id: campaignId },
      responseType: 'blob',
    }).then(r => r.data),
}

// ============================================================
// Phish page context
// ============================================================
export const phishApi = {
  getContext: (uuid) => api.get(`/phish/${uuid}`).then(r => r.data),
  submitCreds: (uuid) =>
    api.post(`/track/cred/${uuid}`).then(r => r.data),
  submitQuiz: (uuid, score, answers) =>
    api.post(`/track/quiz/${uuid}`, { score, answers }).then(r => r.data),
}

// ============================================================
// Utility: trigger browser download from blob
// ============================================================
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const profileApi = {
  get: () => api.get('/profile/').then(r => r.data),
  update: (data) => api.put('/profile/', data).then(r => r.data),
  acceptTerms: () => api.post('/profile/terms-consent').then(r => r.data),
}

export const teamApi = {
  getMembers: () => api.get('/invite/members').then(r => r.data),
  invite: (data) => api.post('/invite', data).then(r => r.data),
  updateRole: (userId, role) => api.put(`/invite/members/${userId}/role`, { role }).then(r => r.data),
  removeMember: (userId) => api.delete(`/invite/members/${userId}`).then(r => r.data),
}

export default api
