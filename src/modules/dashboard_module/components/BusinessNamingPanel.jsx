import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getBusinessDisplayName, getBusinessSecondaryName } from '../../../lib/businessNames';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function profileName(profile, fallback = '—') {
  if (!profile) return fallback;
  return profile.full_name || [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ') || fallback;
}

function StatusPill({ status }) {
  const normalized = String(status || '').toLowerCase();
  const color =
    normalized === 'approved'
      ? { background: '#dcfce7', color: '#166534', border: '#bbf7d0' }
      : normalized === 'rejected'
        ? { background: '#fee2e2', color: '#991b1b', border: '#fecaca' }
        : { background: '#fef3c7', color: '#854d0e', border: '#fde68a' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 'fit-content',
        border: `1px solid ${color.border}`,
        borderRadius: 999,
        padding: '4px 10px',
        background: color.background,
        color: color.color,
        fontSize: 12,
        fontWeight: 900,
        textTransform: 'capitalize',
      }}
    >
      {status || 'pending'}
    </span>
  );
}

export default function BusinessNamingPanel({ mode = 'head_inspector' }) {
  const isDirector = mode === 'director';
  const [search, setSearch] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [profilesById, setProfilesById] = useState(new Map());
  const [drafts, setDrafts] = useState({});
  const [editingBusinessPk, setEditingBusinessPk] = useState(null);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const pendingByBusinessPk = useMemo(() => {
    const map = new Map();
    (requests || [])
      .filter((request) => String(request.status || '').toLowerCase() === 'pending')
      .forEach((request) => map.set(request.business_pk, request));
    return map;
  }, [requests]);

  const loadProfiles = async (profileIds) => {
    const ids = Array.from(new Set((profileIds || []).filter(Boolean)));
    if (ids.length === 0) {
      setProfilesById(new Map());
      return;
    }

    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, first_name, middle_name, last_name')
      .in('id', ids);

    if (profileError) throw profileError;
    setProfilesById(new Map((data || []).map((profile) => [profile.id, profile])));
  };

  const loadDirectorRequests = async () => {
    const { data: requestRows, error: requestError } = await supabase
      .from('business_name_requests')
      .select('id, business_pk, proposed_marketed_name, status, requested_by, requested_at, reviewed_by, reviewed_at, director_comment')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(100);

    if (requestError) throw requestError;

    const businessPks = Array.from(new Set((requestRows || []).map((row) => row.business_pk).filter(Boolean)));
    const { data: businessRows, error: businessError } = businessPks.length
      ? await supabase
          .from('businesses')
          .select('business_pk, business_name, marketed_name, business_address, marketed_name_approved_at')
          .in('business_pk', businessPks)
      : { data: [], error: null };

    if (businessError) throw businessError;

    const businessByPk = new Map((businessRows || []).map((business) => [business.business_pk, business]));
      const merged = (requestRows || []).map((request) => ({
      ...request,
      business: businessByPk.get(request.business_pk) || null,
    }));

      setRequests(merged);
      await loadProfiles(merged.map((request) => request.requested_by));
  };

  const loadHeadInspectorBusinesses = async () => {
    const q = search.trim();
    let query = supabase
      .from('businesses')
      .select('business_pk, business_name, marketed_name, business_address, marketed_name_approved_at')
      .order('business_name', { ascending: true })
      .limit(40);

    if (q) {
      query = query.or(`business_name.ilike.%${q}%,marketed_name.ilike.%${q}%,business_address.ilike.%${q}%`);
    }

    const { data: businessRows, error: businessError } = await query;
    if (businessError) throw businessError;

    const businessPks = (businessRows || []).map((business) => business.business_pk).filter(Boolean);
    const { data: requestRows, error: requestError } = businessPks.length
      ? await supabase
          .from('business_name_requests')
          .select('id, business_pk, proposed_marketed_name, status, requested_by, requested_at, reviewed_by, reviewed_at, director_comment')
          .in('business_pk', businessPks)
          .order('requested_at', { ascending: false })
      : { data: [], error: null };

    if (requestError) throw requestError;

    setBusinesses(businessRows || []);
    setRequests(requestRows || []);
      setDrafts((prev) => {
      const next = { ...prev };
      for (const business of businessRows || []) {
        if (next[business.business_pk] === undefined) {
          const pending = (requestRows || []).find(
            (request) => request.business_pk === business.business_pk && String(request.status || '').toLowerCase() === 'pending'
          );
          next[business.business_pk] = pending?.proposed_marketed_name || business.marketed_name || '';
        }
      }
      return next;
      });
      setEditingBusinessPk((current) => {
        if (!current) return current;
        return (businessRows || []).some((business) => business.business_pk === current) ? current : null;
      });
    };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      if (isDirector) {
        await loadDirectorRequests();
      } else {
        await loadHeadInspectorBusinesses();
      }
    } catch (err) {
      setError(err?.message || 'Failed to load business naming data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirector]);

  useEffect(() => {
    if (isDirector) return;
    const timer = setTimeout(() => {
      loadData();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const channel = supabase
      .channel(`business-naming-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_name_requests' }, () => loadData())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'businesses' }, () => loadData())
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isDirector, search]);

  const submitProposal = async (business) => {
    const proposedName = String(drafts[business.business_pk] || '').trim();
    if (!proposedName) {
      setError('Enter a public/common name before submitting.');
      return;
    }

    setBusyKey(`propose-${business.business_pk}`);
    setError('');
    setToast('');
    try {
      const { error: rpcError } = await supabase.rpc('propose_business_marketed_name', {
        p_business_pk: business.business_pk,
        p_marketed_name: proposedName,
      });

      if (rpcError) throw rpcError;
      setToast('Naming request submitted for Director approval.');
      setEditingBusinessPk(null);
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to submit naming request.');
    } finally {
      setBusyKey('');
    }
  };

  const reviewRequest = async (request, decision) => {
    setBusyKey(`${decision}-${request.id}`);
    setError('');
    setToast('');
    try {
      const { error: rpcError } = await supabase.rpc('review_business_marketed_name_request', {
        p_request_id: request.id,
        p_decision: decision,
        p_director_comment: comments[request.id] || null,
      });

      if (rpcError) throw rpcError;
      setToast(decision === 'approved' ? 'Public name approved.' : 'Naming request rejected.');
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to review naming request.');
    } finally {
      setBusyKey('');
    }
  };

  const rows = isDirector ? requests : businesses;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!isDirector ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search legal name, public name, or address"
            style={{
              flex: '1 1 320px',
              minWidth: 240,
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: '11px 12px',
              fontWeight: 700,
              color: '#0f172a',
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadData}
            disabled={loading}
            style={{ minHeight: 42 }}
          >
            Refresh
          </button>
        </div>
      ) : null}

      {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
      {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

      {loading && rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          Loading...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          {isDirector ? 'No pending naming approvals.' : 'No businesses found.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {isDirector
            ? rows.map((request) => {
                const business = request.business || {};
                const requester = profilesById.get(request.requested_by);
                return (
                  <section key={request.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, background: '#ffffff', display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 1000, color: '#0f172a' }}>{request.proposed_marketed_name}</div>
                        <div style={{ fontSize: 13, color: '#475569', fontWeight: 800 }}>Legal name: {business.business_name || '—'}</div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{business.business_address || '—'}</div>
                      </div>
                      <StatusPill status={request.status} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase' }}>Current Public Name</div>
                        <div style={{ fontWeight: 900, color: '#0f172a', marginTop: 4 }}>{getBusinessDisplayName(business) || '—'}</div>
                      </div>
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase' }}>Requested By</div>
                        <div style={{ fontWeight: 900, color: '#0f172a', marginTop: 4 }}>{profileName(requester, String(request.requested_by || '').slice(0, 8))}</div>
                      </div>
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase' }}>Submitted</div>
                        <div style={{ fontWeight: 900, color: '#0f172a', marginTop: 4 }}>{formatDate(request.requested_at)}</div>
                      </div>
                    </div>

                    <textarea
                      value={comments[request.id] || ''}
                      onChange={(event) => setComments((prev) => ({ ...prev, [request.id]: event.target.value }))}
                      placeholder="Director comment (optional)"
                      rows={2}
                      style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 10, padding: 10, resize: 'vertical', fontWeight: 700 }}
                    />

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={Boolean(busyKey)}
                        onClick={() => reviewRequest(request, 'rejected')}
                      >
                        {busyKey === `rejected-${request.id}` ? 'Rejecting...' : 'Reject'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={Boolean(busyKey)}
                        onClick={() => reviewRequest(request, 'approved')}
                      >
                        {busyKey === `approved-${request.id}` ? 'Approving...' : 'Approve'}
                      </button>
                    </div>
                  </section>
                );
              })
            : rows.map((business) => {
                const pending = pendingByBusinessPk.get(business.business_pk);
                const secondaryName = getBusinessSecondaryName(business);
                const hasApprovedName = Boolean(String(business.marketed_name || '').trim());
                const isEditing = editingBusinessPk === business.business_pk;
                const showInput = !pending && (!hasApprovedName || isEditing);
                return (
                  <section key={business.business_pk} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, background: '#ffffff', display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 1000, color: '#0f172a' }}>{getBusinessDisplayName(business) || '—'}</div>
                        {secondaryName ? <div style={{ fontSize: 13, color: '#475569', fontWeight: 800 }}>Legal name: {secondaryName}</div> : null}
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{business.business_address || '—'}</div>
                      </div>
                      {pending ? <StatusPill status={pending.status} /> : <StatusPill status={business.marketed_name ? 'approved' : 'No public name'} />}
                    </div>

                    {pending ? (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12, color: '#854d0e', fontWeight: 800 }}>
                        Pending Director approval: {pending.proposed_marketed_name}
                      </div>
                    ) : null}

                    {showInput ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 10, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={drafts[business.business_pk] || ''}
                          onChange={(event) => setDrafts((prev) => ({ ...prev, [business.business_pk]: event.target.value }))}
                          placeholder="Enter public/common name"
                          style={{ minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 10, padding: '11px 12px', fontWeight: 700 }}
                        />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {hasApprovedName && isEditing ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={Boolean(busyKey)}
                              onClick={() => {
                                setDrafts((prev) => ({ ...prev, [business.business_pk]: business.marketed_name || '' }));
                                setEditingBusinessPk(null);
                              }}
                              style={{ minHeight: 42, whiteSpace: 'nowrap' }}
                            >
                              Cancel
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={Boolean(busyKey)}
                            onClick={() => submitProposal(business)}
                            style={{ minHeight: 42, whiteSpace: 'nowrap' }}
                          >
                            {busyKey === `propose-${business.business_pk}` ? 'Submitting...' : hasApprovedName ? 'Submit Edit for Approval' : 'Submit for Approval'}
                          </button>
                        </div>
                      </div>
                    ) : hasApprovedName && !pending ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase' }}>Approved Public Name</div>
                          <div style={{ fontWeight: 1000, color: '#0f172a', marginTop: 4 }}>{business.marketed_name}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={Boolean(busyKey)}
                          onClick={() => {
                            setDrafts((prev) => ({ ...prev, [business.business_pk]: business.marketed_name || '' }));
                            setEditingBusinessPk(business.business_pk);
                          }}
                          style={{ minHeight: 42, whiteSpace: 'nowrap' }}
                        >
                          Edit
                        </button>
                      </div>
                    ) : null}

                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                      BIN/Business PK: {business.business_pk}
                      {business.marketed_name_approved_at ? ` | Approved ${formatDate(business.marketed_name_approved_at)}` : ''}
                    </div>
                  </section>
                );
              })}
        </div>
      )}
    </div>
  );
}
