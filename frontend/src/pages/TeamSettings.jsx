import React, { useState, useEffect } from 'react';
import { teamApi } from '../lib/api';
import toast from 'react-hot-toast';

export default function TeamSettings() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const data = await teamApi.getMembers();
      setMembers(data);
    } catch (e) {
      toast.error('Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await teamApi.invite({ email: inviteEmail, role: inviteRole });
      toast.success('Invite sent successfully');
      setInviteEmail('');
      fetchMembers();
    } catch (e) {
      toast.error('Failed to send invite');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await teamApi.updateRole(userId, newRole);
      toast.success('Role updated');
      fetchMembers();
    } catch (e) {
      toast.error('Failed to update role');
    }
  };

  const handleRemove = async (userId) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await teamApi.removeMember(userId);
      toast.success('Member removed');
      fetchMembers();
    } catch (e) {
      toast.error('Failed to remove member');
    }
  };

  if (loading) {
    return <div className="p-8 text-slate-400">Loading team...</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Team Settings</h1>
        <p className="text-slate-400">Manage your organisation's members and their roles.</p>
      </div>

      {/* Invite Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-medium text-white mb-4">Invite New Member</h2>
        <form onSubmit={handleInvite} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-400 mb-2">Email Address</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              required
            />
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-slate-400 mb-2">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            >
              <option value="admin">Admin</option>
              <option value="analyst">Analyst</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2 rounded-lg transition-colors h-[42px]"
          >
            Send Invite
          </button>
        </form>
      </div>

      {/* Members List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-medium text-white">Current Members</h2>
        </div>
        <div className="divide-y divide-slate-800">
          {members.map(member => (
            <div key={member.id} className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{member.full_name || member.email}</p>
                <p className="text-xs text-slate-500 mt-1">{member.email}</p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="admin">Admin</option>
                  <option value="analyst">Analyst</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={() => handleRemove(member.id)}
                  className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  title="Remove member"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">
              No members found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
