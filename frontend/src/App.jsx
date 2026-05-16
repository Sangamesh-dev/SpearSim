import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/AuthProvider.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import NewCampaign from './pages/NewCampaign.jsx'
import CampaignDetail from './pages/CampaignDetail.jsx'
import Compliance from './pages/Compliance.jsx'
import PhishPage from './pages/PhishPage.jsx'
import TeamSettings from './pages/TeamSettings.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public login page */}
          <Route path="/login" element={<Login />} />

          {/* Public phishing simulation page — no auth, no layout */}
          <Route path="/phish/:uuid" element={<PhishPage />} />

          {/* Authenticated app */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/campaigns/new" element={<NewCampaign />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/settings/team" element={
              <ProtectedRoute requiredRole="admin"><TeamSettings /></ProtectedRoute>
            } />
            {/* Legacy /team redirect */}
            <Route path="/team" element={<Navigate to="/settings/team" replace />} />
          </Route>

          {/* 404 fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
