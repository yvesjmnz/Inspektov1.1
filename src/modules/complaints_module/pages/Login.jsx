import { useEffect, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    // Strategy (in priority order):
    // 1) custom claim in app_metadata.role
    // 2) user_metadata.role
    // 3) profiles table (if you have one) -> profiles.role

    const role = user?.app_metadata?.role || user?.user_metadata?.role;

    if (role) {
      navigateToDashboard(role);
      return;
    }

    // Optional fallback: try a profiles table if it exists.
    // If it doesn't exist, we silently ignore and show a helpful error.
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

    // Adjust these mappings later when dashboards exist.
    // Role mapping (can be adjusted later)
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
    <div className="login-container">
      <Header />
      <main className="login-main">
        <section className="login-card">
          <h2 className="login-title">Login</h2>
          <p className="login-subtitle">Sign in to continue to your dashboard.</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="login-input"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <label className="login-label" htmlFor="password">Password</label>
            <input
              id="password"
              className="login-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {error ? <div className="login-alert login-alert-error">{error}</div> : null}

          <div className="login-help">
            <a className="login-back" href="/">Back to Home</a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
