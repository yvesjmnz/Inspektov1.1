import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // If already logged in, go straight to role routing.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data?.session?.user) {
        await routeByRole(data.session.user);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const routeByRole = async (user) => {
    const role = user?.app_metadata?.role || user?.user_metadata?.role;

    if (role) {
      navigateToDashboard(role);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data?.role) {
        navigateToDashboard(data.role);
        return;
      }
    } catch (e) {
      // ignore; handled below
    }

    setError(
      'Logged in, but no role was found for this account. Please contact an administrator.'
    );
  };

  const navigateToDashboard = (roleValue) => {
    const role = String(roleValue).toLowerCase();

    if (role === 'director') {
      window.location.href = '/dashboard/director';
      return;
    }

    if (role === 'head inspector' || role === 'head_inspector' || role === 'headinspector') {
      window.location.href = '/dashboard/head-inspector';
      return;
    }

    if (role === 'inspector') {
      window.location.href = '/dashboard/inspector';
      return;
    }

    // default
    window.location.href = '/dashboard';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      const user = data?.user;
      if (!user) {
        setError('Login succeeded but user data was not returned.');
        return;
      }

      await routeByRole(user);
    } catch (err) {
      setError(err?.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-split">
        {/* Left column: branding + form (light panel) */}
        <aside className="auth-left">
          <div className="auth-left-inner">
            <div className="auth-brand">
              <img className="auth-logo" src="/bureau-permits.png" alt="Bureau of Permits" />
              <div className="auth-brand-text">
                <h1 className="auth-brand-title">Inspekto</h1>
                <p className="auth-brand-tagline">Complaint Management System</p>
              </div>
            </div>

            <section className="auth-card">
              <h2 className="auth-title">Sign in</h2>
              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-label" htmlFor="email">Email address</label>
                <input
                  id="email"
                  className="auth-input"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />

                <label className="auth-label" htmlFor="password">Password</label>
                <div className="auth-password-wrapper">
                  <input
                    id="password"
                    className="auth-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <img
                      src={showPassword ? '/open eye.png' : '/closed eye.png'}
                      alt={showPassword ? 'Hide password' : 'Show password'}
                      className="auth-password-icon"
                    />
                  </button>
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </form>

              {error ? <div className="auth-alert auth-alert-error">{error}</div> : null}
            </section>
          </div>
        </aside>

        {/* Right column: image panel */}
        <div className="auth-right" aria-hidden="true">
          <div className="auth-photo-overlay" />
        </div>
      </div>
    </div>
  );
}
