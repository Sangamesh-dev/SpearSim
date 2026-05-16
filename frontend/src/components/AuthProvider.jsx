import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/auth';
import { profileApi } from '../lib/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(true); // default true until profile fetched
  const [loading, setLoading] = useState(true);

  const acceptTerms = async () => {
    try {
      await profileApi.acceptTerms();
      setTermsAccepted(true);
    } catch (e) {
      console.error("Failed to accept terms", e);
      throw e;
    }
  };

  useEffect(() => {
    const fetchProfile = async (sessionUser) => {
      if (!sessionUser) {
        setUser(null);
        setRole(null);
        setOrgId(null);
        setOrgName('');
        setFullName('');
        setTermsAccepted(true);
        setLoading(false);
        return;
      }
      
      setUser(sessionUser);
      try {
        const profile = await profileApi.get();
        setRole(profile.role);
        setOrgId(profile.org_id);
        setOrgName(profile.org_name || '');
        setFullName(profile.full_name);
        setTermsAccepted(profile.terms_accepted ?? false);
      } catch (e) {
        console.error("Failed to fetch profile", e);
        setRole(sessionUser.user_metadata?.role ?? 'viewer');
        setTermsAccepted(true); // fallback to prevent blocking
      }
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      fetchProfile(session?.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      fetchProfile(session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = {
    session,
    user,
    role,
    orgId,
    orgName,
    fullName,
    termsAccepted,
    acceptTerms,
    loading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
