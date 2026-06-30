import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export default function ReporterBanPanel() {
  const [bans, setBans] = useState([]);
  const [recentComplaints, setRecentComplaints] = useState([]);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const since = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
      const [{ data: banRows, error: banError }, { data: complaintRows, error: complaintError }] = await Promise.all([
        supabase
          .from('reporter_bans')
          .select('id, email, reason, active, banned_at, unbanned_at, updated_at')
          .order('updated_at', { ascending: false }),
        supabase
          .from('complaints')
          .select('id, reporter_email, business_name, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(2000),
      ]);
      if (banError) throw banError;
      if (complaintError) throw complaintError;
      setBans(banRows || []);
      setRecentComplaints(complaintRows || []);
    } catch (err) {
      setError(err?.message || 'Failed to load reporter moderation records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeBanByEmail = useMemo(
    () => new Map(bans.filter((row) => row.active).map((row) => [normalizeEmail(row.email), row])),
    [bans]
  );

  const reporterActivity = useMemo(() => {
    const byEmail = new Map();
    recentComplaints.forEach((complaint) => {
      const key = normalizeEmail(complaint.reporter_email);
      if (!key) return;
      if (!byEmail.has(key)) {
        byEmail.set(key, {
          email: complaint.reporter_email,
          count: 0,
          businesses: new Set(),
          latestAt: complaint.created_at,
        });
      }
      const entry = byEmail.get(key);
      entry.count += 1;
      if (complaint.business_name) entry.businesses.add(complaint.business_name);
    });

    return Array.from(byEmail.values())
      .filter((entry) => entry.count >= 3)
      .map((entry) => ({ ...entry, businessCount: entry.businesses.size }))
      .sort((a, b) => b.count - a.count);
  }, [recentComplaints]);

  const visibleBans = useMemo(() => {
    const query = normalizeEmail(search);
    return bans.filter((row) => !query || normalizeEmail(row.email).includes(query));
  }, [bans, search]);

  const setBan = async (targetEmail, active, targetReason = '') => {
    const normalized = normalizeEmail(targetEmail);
    if (!normalized) return;
    setSavingEmail(normalized);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await supabase.rpc('set_reporter_ban', {
        p_email: normalized,
        p_reason: active ? String(targetReason || '').trim() : null,
        p_active: active,
      });
      if (rpcError) throw rpcError;
      setNotice(active ? `${normalized} can no longer submit complaints.` : `${normalized} can submit complaints again.`);
      setEmail('');
      setReason('');
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to update reporter access.');
    } finally {
      setSavingEmail('');
    }
  };

  const submitBan = async (event) => {
    event.preventDefault();
    await setBan(email, true, reason);
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}
      {notice ? <div className="dash-alert" style={{ borderColor: '#86efac', background: '#f0fdf4', color: '#166534' }}>{notice}</div> : null}

      <section style={{ background: '#fff', border: '1px solid #dbe3ef', borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>Block a reporter email</div>
        <div style={{ marginTop: 4, color: '#64748b', fontSize: 13 }}>
          Blocking takes effect immediately at email verification and complaint submission.
        </div>
        <form onSubmit={submitBan} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(280px, 1.4fr) auto', gap: 10, marginTop: 16 }}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="reporter@example.com"
            required
            style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px' }}
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for blocking"
            required
            style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px' }}
          />
          <button className="dash-btn dash-btn-danger" type="submit" disabled={Boolean(savingEmail)}>
            Block reporter
          </button>
        </form>
      </section>

      <section style={{ background: '#fff', border: '1px solid #dbe3ef', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>Recent high-volume reporters</div>
          <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>Only reporters with at least three complaints in the last seven days are shown.</div>
        </div>
        {loading ? <div style={{ padding: 20, color: '#64748b' }}>Loading…</div> : (
          <div style={{ display: 'grid' }}>
            {reporterActivity.map((entry) => {
              const banned = activeBanByEmail.has(normalizeEmail(entry.email));
              return (
                <div key={entry.email} style={{ padding: '14px 18px', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>{entry.email}</div>
                    <div style={{ marginTop: 3, color: '#64748b', fontSize: 12 }}>{entry.count} complaints · {entry.businessCount} establishments</div>
                  </div>
                  {banned ? (
                    <span style={{ color: '#991b1b', background: '#fef2f2', borderRadius: 999, padding: '6px 10px', fontWeight: 900, fontSize: 12 }}>Blocked</span>
                  ) : (
                    <button
                      type="button"
                      className="dash-btn dash-btn-danger"
                      onClick={() => {
                        setEmail(entry.email);
                        setReason(`${entry.count} complaints across ${entry.businessCount} establishments in seven days`);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Review to block
                    </button>
                  )}
                </div>
              );
            })}
            {!reporterActivity.length ? <div style={{ padding: 20, color: '#64748b' }}>No high-volume reporters found.</div> : null}
          </div>
        )}
      </section>

      <section style={{ background: '#fff', border: '1px solid #dbe3ef', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: 18, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>Reporter access history</div>
            <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>Active and previously removed bans.</div>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email"
            style={{ minHeight: 38, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px' }}
          />
        </div>
        {visibleBans.map((ban) => (
          <div key={ban.id} style={{ padding: '14px 18px', borderBottom: '1px solid #edf2f7', display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.5fr) auto', gap: 18, alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 900, color: '#0f172a' }}>{ban.email}</div>
              <div style={{ marginTop: 3, color: ban.active ? '#991b1b' : '#64748b', fontSize: 12, fontWeight: 800 }}>{ban.active ? 'Blocked' : 'Access restored'}</div>
            </div>
            <div style={{ color: '#475569', fontSize: 13 }}>{ban.reason}</div>
            {ban.active ? (
              <button
                type="button"
                className="dash-btn"
                disabled={savingEmail === normalizeEmail(ban.email)}
                onClick={() => setBan(ban.email, false)}
              >
                Restore access
              </button>
            ) : <span />}
          </div>
        ))}
        {!loading && !visibleBans.length ? <div style={{ padding: 20, color: '#64748b' }}>No reporter bans found.</div> : null}
      </section>
    </div>
  );
}
