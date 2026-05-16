import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import toast from 'react-hot-toast';

export default function TermsModal() {
  const { termsAccepted, acceptTerms, user, loading } = useAuth();
  const [certifyAuth, setCertifyAuth] = useState(false);
  const [certifyEthical, setCertifyEthical] = useState(false);
  const [certifyGdpr, setCertifyGdpr] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // If loading, not logged in, or already accepted, do not show modal
  if (loading || !user || termsAccepted) return null;

  const allChecked = certifyAuth && certifyEthical && certifyGdpr;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!allChecked) return;
    setSubmitting(true);
    try {
      await acceptTerms();
      toast.success('Ethical use terms acknowledged successfully. Welcome to SpearSim.');
    } catch (err) {
      setSubmitting(false);
      toast.error('Failed to record consent. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-blue-500/30 rounded-2xl shadow-2xl overflow-hidden p-8 flex flex-col gap-6">
        {/* Glow effect */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center gap-2">
          <div className="w-16 h-16 bg-blue-600/20 border border-blue-500/40 rounded-2xl flex items-center justify-center text-blue-400 mb-2 shadow-inner">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide">
            Ethical Use & Compliance Agreement
          </h2>
          <p className="text-sm text-slate-400 max-w-lg">
            SpearSim simulates high-fidelity cyber attacks. Prior to operating the platform, you must certify legal authorization and agree to our ethical operating parameters.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative z-10 flex flex-col gap-4 my-2">
          {/* Checkbox 1 */}
          <label className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
            certifyAuth ? 'bg-blue-600/10 border-blue-500/50 text-white' : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-600'
          }`}>
            <input
              type="checkbox"
              checked={certifyAuth}
              onChange={(e) => setCertifyAuth(e.target.checked)}
              className="mt-1 w-5 h-5 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
            />
            <div className="flex flex-col text-sm">
              <span className="font-semibold text-white flex items-center gap-2">
                🛡️ Explicit Legal Authorization
              </span>
              <span className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                I certify that I hold explicit written authorization from executive leadership to conduct security awareness phishing simulations against all targeted domain names and employee email addresses.
              </span>
            </div>
          </label>

          {/* Checkbox 2 */}
          <label className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
            certifyEthical ? 'bg-blue-600/10 border-blue-500/50 text-white' : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-600'
          }`}>
            <input
              type="checkbox"
              checked={certifyEthical}
              onChange={(e) => setCertifyEthical(e.target.checked)}
              className="mt-1 w-5 h-5 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
            />
            <div className="flex flex-col text-sm">
              <span className="font-semibold text-white flex items-center gap-2">
                ⚖️ Educational & Non-Punitive Use
              </span>
              <span className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                I acknowledge that phishing simulations are conducted strictly for employee training and education. I agree not to use captured engagement metrics for disciplinary or punitive actions against personnel.
              </span>
            </div>
          </label>

          {/* Checkbox 3 */}
          <label className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
            certifyGdpr ? 'bg-blue-600/10 border-blue-500/50 text-white' : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-600'
          }`}>
            <input
              type="checkbox"
              checked={certifyGdpr}
              onChange={(e) => setCertifyGdpr(e.target.checked)}
              className="mt-1 w-5 h-5 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
            />
            <div className="flex flex-col text-sm">
              <span className="font-semibold text-white flex items-center gap-2">
                🔒 Data Minimization & Privacy
              </span>
              <span className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                I agree to adhere to GDPR data minimization principles. I acknowledge that simulation records are stored pseudonymously and automatically scheduled for retention purge.
              </span>
            </div>
          </label>

          <div className="pt-4 flex items-center justify-between border-t border-slate-800 mt-2">
            <span className="text-xs text-slate-500">
              Logged in as: <strong className="text-slate-300">{user?.email}</strong>
            </span>
            <button
              type="submit"
              disabled={!allChecked || submitting}
              className={`px-6 py-3 rounded-xl font-medium text-sm transition-all duration-200 shadow-lg flex items-center gap-2 ${
                allChecked && !submitting
                  ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-500/20 active:scale-95 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Recording Consent...
                </>
              ) : (
                <>
                  I Acknowledge & Agree
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
