import React from 'react'

export default function LoadingSpinner({ size = 'md', label = 'Loading...' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className={`${sizes[size]} border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin`} />
      {label && <p className="text-sm text-slate-500">{label}</p>}
    </div>
  )
}
