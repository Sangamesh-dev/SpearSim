import React from 'react'

export default function StatusBadge({ status }) {
  const map = {
    draft: 'badge-draft',
    active: 'badge-active',
    completed: 'badge-completed',
  }
  return (
    <span className={map[status] || 'badge-draft'}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
