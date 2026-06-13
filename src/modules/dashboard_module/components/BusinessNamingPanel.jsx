import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getBusinessDisplayName, getBusinessSecondaryName } from '../../../lib/businessNames';

function formatDateOnly(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function formatTimeOnly(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function profileName(profile, fallback = '-') {
  if (!profile) return fallback;
  return profile.full_name || [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ') || fallback;
}

function StatusPill({ status }) {
  const normalized = String(status || '').toLowerCase().replace(/\s+/g, '_');
  const color =
    normalized === 'approved'
      ? { background: '#dcfce7', color: '#166534', border: '#bbf7d0' }
      : normalized === 'rejected'
        ? { background: '#fee2e2', color: '#991b1b', border: '#fecaca' }
        : normalized === 'pending'
          ? { background: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' }
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

const getStatusLabel = (status) => {
  if (status === 'no_public_name') return 'No Public Name';
  return status || 'pending';
};

export default function BusinessNamingPanel({ mode = 'head_inspector' }) {
  const isDirector = mode === 'director';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [businesses, setBusinesses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [profilesById, setProfilesById] = useState(new Map());
  const [drafts, setDrafts] = useState({});
  const [submitModalBusinessPk, setSubmitModalBusinessPk] = useState(null);
  const [expandedDirectorRequestId, setExpandedDirectorRequestId] = useState(null);
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

  const latestRequestByBusinessPk = useMemo(() => {
    const map = new Map();
    (requests || []).forEach((request) => {
      if (!map.has(request.business_pk)) map.set(request.business_pk, request);
    });
    return map;
  }, [requests]);

  const getHeadInspectorStatus = useCallback((business) => {
    if (pendingByBusinessPk.has(business.business_pk)) return 'pending';
    if (String(business.marketed_name || '').trim()) return 'approved';
    if (String(latestRequestByBusinessPk.get(business.business_pk)?.status || '').toLowerCase() === 'rejected') return 'rejected';
    return 'no_public_name';
  }, [pendingByBusinessPk, latestRequestByBusinessPk]);

  const filteredBusinesses = useMemo(() => {
    if (isDirector || statusFilter === 'all') return businesses;
    return businesses.filter((business) => getHeadInspectorStatus(business) === statusFilter);
  }, [businesses, isDirector, statusFilter, getHeadInspectorStatus]);

  const modalBusiness = useMemo(
    () => businesses.find((business) => business.business_pk === submitModalBusinessPk) || null,
    [businesses, submitModalBusinessPk]
  );

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
    setSubmitModalBusinessPk((current) => {
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
      setSubmitModalBusinessPk(null);
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

  const rows = isDirector ? requests : filteredBusinesses;
  const hasActiveHeadInspectorFilter = !isDirector && statusFilter !== 'all';

  const openSubmitModal = (business) => {
    setError('');
    setToast('');
    setDrafts((prev) => ({
      ...prev,
      [business.business_pk]: prev[business.business_pk] ?? business.marketed_name ?? '',
    }));
    setSubmitModalBusinessPk(business.business_pk);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!isDirector ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search legal name, public name, or address"
            style={{
              width: '100%',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              padding: '11px 12px',
              fontWeight: 700,
              color: '#0f172a',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid #dbe3ef', borderRadius: 4, background: '#f8fafc', padding: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
              Status:
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={{ height: 32, minWidth: 150, border: '1px solid #cbd5e1', borderRadius: 4, background: '#ffffff', color: '#0f172a', fontSize: 13, fontWeight: 700, padding: '0 8px' }}
              >
                <option value="all">All Statuses</option>
                <option value="no_public_name">No Public Name</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#475569' }}>
              <span>Active Filters: {hasActiveHeadInspectorFilter ? 1 : 0}</span>
              {hasActiveHeadInspectorFilter ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  style={{ border: 'none', background: 'transparent', color: '#2563eb', fontWeight: 900, cursor: 'pointer', padding: 0 }}
                >
                  Clear All
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={loadData}
                disabled={loading}
                style={{ minHeight: 36 }}
              >
                Refresh Data
              </button>
            </div>
          </div>
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
          {isDirector ? 'No pending naming approvals.' : 'No businesses match the current filters.'}
        </div>
      ) : isDirector ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((request) => {
            const business = request.business || {};
            const requester = profilesById.get(request.requested_by);
            const requesterName = profileName(requester, String(request.requested_by || '').slice(0, 8));
            const expandedId = expandedDirectorRequestId === null ? rows[0]?.id : expandedDirectorRequestId;
            const isExpanded = expandedId === request.id;
            return (
              <section key={request.id} style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#ffffff', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpandedDirectorRequestId(isExpanded ? '' : request.id)}
                  aria-expanded={isExpanded}
                  style={{ width: '100%', border: 'none', background: isExpanded ? '#ffffff' : '#f8fafc', cursor: 'pointer', textAlign: 'left', padding: isExpanded ? '22px 20px' : 14 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, display: 'grid', gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Legal Name</div>
                      <div style={{ fontSize: isExpanded ? 22 : 18, fontWeight: 1000, color: '#020617', lineHeight: 1.1 }}>{business.business_name || '-'}</div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, marginTop: 4 }}>
                        <img src="/ui_icons/Address.png" alt="Address" style={{ width: 16, height: 16, opacity: 0.75 }} />
                        <span style={{ lineHeight: 1.4 }}>{business.business_address || '-'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flex: '0 0 auto' }}>
                      {isExpanded ? (
                        <span aria-hidden="true" style={{ width: 80, height: 56, border: '1px solid #cbd5e1', borderRadius: 4, background: '#f1f5f9', color: '#64748b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 1000, lineHeight: 1.1, whiteSpace: 'nowrap', fontSize: 13 }}>
                          PK #{business.business_pk || '-'}
                        </span>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 18, color: '#64748b', fontSize: 12, fontWeight: 800 }}>
                          <span>{formatDateOnly(request.requested_at)}</span>
                          <span aria-hidden="true" style={{ color: '#2563eb' }}>View</span>
                          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>&gt;</span>
                        </div>
                      )}
                      {isExpanded ? <StatusPill status={request.status} /> : null}
                    </div>
                  </div>
                </button>

                {isExpanded ? (
                  <div style={{ borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(190px, 1fr))', gap: 12, padding: '16px', background: '#f8fafc' }}>
                      <div style={{ background: '#eef2f7', borderRadius: 4, padding: '16px 18px', display: 'grid', gap: 10, minHeight: 120 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Current Public Name</div>
                        <div style={{ fontWeight: 1000, color: '#020617', fontSize: 16 }}>{getBusinessDisplayName(business) || '-'}</div>
                      </div>
                      <div style={{ background: '#ffffff', borderRadius: 4, border: '1px solid #dbe3ef', padding: '16px 18px', display: 'grid', gap: 10, minHeight: 120 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Proposed Public Name</div>
                        <div style={{ fontWeight: 1000, color: '#2563eb', fontSize: 16 }}>{request.proposed_marketed_name || '-'}</div>
                      </div>
                      <div style={{ background: '#f1f5f9', borderRadius: 4, padding: '16px 18px', display: 'grid', gap: 12, minHeight: 120 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Submitted Info</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Date & Time</span>
                            <span style={{ fontWeight: 1000, color: '#020617', fontSize: 15 }}>{formatDateOnly(request.requested_at)}</span>
                            <span style={{ fontSize: 11, color: '#64748b' }}>{formatTimeOnly(request.requested_at)}</span>
                          </div>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Requested by</span>
                            <span style={{ fontWeight: 1000, color: '#020617', fontSize: 15 }}>{requesterName}</span>
                            <span style={{ fontSize: 11, color: '#64748b' }}>Head Inspector</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 8, padding: '20px 20px 18px' }}>
                      <label htmlFor={`director-comment-${request.id}`} style={{ fontSize: 11, color: '#0f172a', fontWeight: 900, letterSpacing: 0.8, textTransform: 'uppercase' }}>Director&apos;s Decision Notes</label>
                      <textarea
                        id={`director-comment-${request.id}`}
                        value={comments[request.id] || ''}
                        onChange={(event) => setComments((prev) => ({ ...prev, [request.id]: event.target.value }))}
                        placeholder="Provide administrative justification for approval or rejection..."
                        rows={3}
                        style={{ width: '100%', minHeight: 80, border: '1px solid #cbd5e1', borderRadius: 3, padding: 14, resize: 'vertical', fontWeight: 700, background: '#f1f5f9', color: '#0f172a' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '0 20px 20px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={Boolean(busyKey)}
                        onClick={() => reviewRequest(request, 'rejected')}
                        style={{ minHeight: 38, minWidth: 96, borderRadius: 4, background: '#ffffff', color: '#0f172a', border: '1px solid #94a3b8', textTransform: 'uppercase', fontSize: 12 }}
                      >
                        {busyKey === `rejected-${request.id}` ? 'Rejecting...' : 'Reject'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={Boolean(busyKey)}
                        onClick={() => reviewRequest(request, 'approved')}
                        style={{ minHeight: 38, minWidth: 170, borderRadius: 4, background: '#0b5ed7', textTransform: 'uppercase', fontSize: 12 }}
                      >
                        {busyKey === `approved-${request.id}` ? 'Approving...' : 'Approve Request'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="dash-table-wrap" style={{ marginTop: 0, borderRadius: 4 }}>
          <table className="dash-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Business Name &amp; Address</th>
                <th style={{ width: '30%' }}>Legal Entity Name</th>
                <th style={{ width: '18%' }}>Status</th>
                <th style={{ width: '18%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((business) => {
                const pending = pendingByBusinessPk.get(business.business_pk);
                const hasApprovedName = Boolean(String(business.marketed_name || '').trim());
                const latest = latestRequestByBusinessPk.get(business.business_pk);
                const status = getHeadInspectorStatus(business);
                const displayName = getBusinessDisplayName(business) || '-';
                const legalName = getBusinessSecondaryName(business) || business.business_name || '-';

                return (
                  <tr key={business.business_pk}>
                    <td>
                      <div className="dash-cell-title">{displayName}</div>
                      <div className="dash-cell-sub">{business.business_address || '-'}</div>
                      <div className="dash-cell-sub">BIN/Business PK: {business.business_pk}</div>
                    </td>
                    <td style={{ color: '#334155', fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', wordBreak: 'break-word' }}>
                      {legalName}
                    </td>
                    <td>
                      <StatusPill status={getStatusLabel(status)} />
                      {pending ? <div className="dash-cell-sub" style={{ marginTop: 6 }}>Proposed: {pending.proposed_marketed_name}</div> : null}
                      {!pending && latest?.status && status === 'rejected' ? <div className="dash-cell-sub" style={{ marginTop: 6 }}>Rejected: {latest.proposed_marketed_name}</div> : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {pending ? (
                        <button type="button" className="btn btn-secondary" disabled style={{ minHeight: 36, whiteSpace: 'nowrap' }}>
                          Pending Review
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={hasApprovedName ? 'btn btn-secondary' : 'btn btn-primary'}
                          disabled={Boolean(busyKey)}
                          onClick={() => openSubmitModal(business)}
                          style={{ minHeight: 36, whiteSpace: 'nowrap' }}
                        >
                          {hasApprovedName ? 'Edit Record' : 'Submit Name'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isDirector && modalBusiness ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="business-name-modal-title"
          style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(15, 23, 42, 0.35)' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busyKey) setSubmitModalBusinessPk(null);
          }}
        >
          <section style={{ width: 'min(520px, 100%)', background: '#ffffff', borderRadius: 8, boxShadow: '0 24px 60px rgba(15, 23, 42, 0.24)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 22px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 id="business-name-modal-title" style={{ margin: 0, color: '#0f172a', fontSize: 20, fontWeight: 900 }}>
                {modalBusiness.marketed_name ? 'Edit Public Name' : 'Submit Public Name'}
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSubmitModalBusinessPk(null)}
                disabled={Boolean(busyKey)}
                style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 26, lineHeight: 1 }}
              >
                x
              </button>
            </div>

            <div style={{ display: 'grid', gap: 18, padding: 22 }}>
              <div style={{ background: '#eef2f7', border: '1px solid #dbe3ef', borderRadius: 4, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>Legal Entity Reference</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>Full Legal Name</div>
                    <div style={{ color: '#0f172a', fontWeight: 800 }}>{modalBusiness.business_name || '-'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>Business PK</div>
                    <div style={{ color: '#0f172a', fontWeight: 800 }}>{modalBusiness.business_pk}</div>
                  </div>
                </div>
              </div>

              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: '#475569', textTransform: 'uppercase' }}>Proposed Public Name</span>
                <input
                  type="text"
                  value={drafts[modalBusiness.business_pk] || ''}
                  onChange={(event) => setDrafts((prev) => ({ ...prev, [modalBusiness.business_pk]: event.target.value }))}
                  placeholder="Enter public/common name"
                  style={{ width: '100%', minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 0, padding: '10px 12px', fontWeight: 800, color: '#0f172a' }}
                />
                <span style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic' }}>This name will be sent to the Director approval queue.</span>
              </label>

              <div style={{ border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 4, padding: 14, display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 700, color: '#b91c1c' }}>Important Notice</div>
                <div style={{ fontSize: 13, color: '#991b1b', fontWeight: 400 }}>Submitting will lock this naming request until it is approved or rejected by the Director.</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '18px 22px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busyKey)}
                onClick={() => setSubmitModalBusinessPk(null)}
                style={{ minHeight: 40, minWidth: 96 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busyKey)}
                onClick={() => submitProposal(modalBusiness)}
                style={{ minHeight: 40, minWidth: 170 }}
              >
                {busyKey === `propose-${modalBusiness.business_pk}` ? 'Submitting...' : 'Confirm Submission'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
