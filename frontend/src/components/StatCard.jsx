import React from 'react'

export default function StatCard({ label, value, sub, color = 'blue', icon }) {
  const colorMap = {
    blue: 'text-blue-400 bg-blue-900/30 border-blue-800/50',
    green: 'text-green-400 bg-green-900/30 border-green-800/50',
    yellow: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
    red: 'text-red-400 bg-red-900/30 border-red-800/50',
    slate: 'text-slate-400 bg-slate-800/50 border-slate-700/50',
  }

  return (
    <div className={`card border ${colorMap[color]} flex items-start gap-4`}>
      {icon && (
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm text-slate-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  )
}
