import React from 'react'

export default function RiskBadge({ level }) {
  const map = {
    Low: 'badge-low',
    Medium: 'badge-medium',
    High: 'badge-high',
  }
  return <span className={map[level] || 'badge-low'}>{level}</span>
}
