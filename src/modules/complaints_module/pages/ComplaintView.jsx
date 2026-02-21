import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import '../../dashboard_module/pages/Dashboard.css';

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ComplaintView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [complaint, setComplaint] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const id = params.get('id');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      setError('');
      try {
        const { data, error } = await supabase
          .from('complaints')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        setComplaint(data);
      } catch (e) {
        setError(e?.message || 'Failed to load complaint');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  return (
    <div className="dash-container" style={{ padding: 16 }}>
      <div className="dash-card" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="dash-header" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 className="dash-title">Review</h2>
            <p className="dash-subtitle">Please check the information before deciding.</p>
          </div>
          <div className="dash-actions">
            <a className="dash-btn" href="/dashboard/director" title="Back to Director Dashboard">Back</a>
            <button className="dash-btn" onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {/* Visual step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 10px 16px 10px' }}>
          {['Submitted','Intake','Review','Decision'].map((step, idx, arr) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <div style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                border: '2px solid #22c55e',
                background: idx <= 2 ? '#dcfce7' : '#fff',
                display: 'grid',
                placeItems: 'center',
                color: '#16a34a',
                fontSize: 12,
                fontWeight: 700,
              }}>{idx+1}</div>
              <div style={{ color: '#0f172a', fontWeight: 700, fontSize: 12 }}>{step}</div>
              {idx < arr.length - 1 ? (
                <div style={{ height: 2, background: '#e2e8f0', flex: 1, marginLeft: 8 }} />
              ) : null}
            </div>
          ))}
        </div>

        {loading ? <div className="dash-alert">Loading…</div> : null}
        {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

        {!complaint ? (
          !loading && !error ? <div className="dash-alert">No record found.</div> : null
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: 16,
            }}>
              {/* Top summary (highest priority) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 280 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{complaint.business_name || '—'}</div>
                  <div style={{ color: '#475569', fontWeight: 700 }}>{complaint.business_address || '—'}</div>
                </div>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="status-badge status-warning" title="Urgency">{complaint?.authenticity_level ?? '—'}</span>
                    <span className="status-badge" title="Status">{formatStatus(complaint.status)}</span>
                  </div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>ID:</strong> {complaint.id}</div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>Submitted:</strong> {complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}</div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>Updated:</strong> {complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—'}</div>
                </div>
              </div>

              <div style={{ height: 1, background: '#f1f5f9', margin: '14px 0' }} />

              {/* Description (second priority) */}
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Description</div>
                <div style={{ whiteSpace: 'pre-wrap', color: '#0f172a' }}>{complaint.complaint_description || '—'}</div>
              </div>

              {/* Evidence (third priority) */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Evidence</div>
                {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {complaint.image_urls.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt="Evidence"
                        onClick={() => setPreviewImage(url)}
                        style={{
                          width: 160,
                          height: 110,
                          objectFit: 'cover',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                          cursor: 'pointer',
                        }}
                        loading="lazy"
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#64748b', fontWeight: 700 }}>No images</div>
                )}
              </div>

              {/* Audit (lowest priority) */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Audit</div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))' }}>
                  <div style={{ color: '#64748b', fontWeight: 700 }}>Approved By</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{complaint.approved_by || '—'}</div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}>Approved At</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{complaint.approved_at ? new Date(complaint.approved_at).toLocaleString() : '—'}</div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}>Declined By</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{complaint.declined_by || '—'}</div>
                  <div style={{ color: '#64748b', fontWeight: 700 }}>Declined At</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{complaint.declined_at ? new Date(complaint.declined_at).toLocaleString() : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {previewImage ? (
        <div
          className="image-overlay"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={() => setPreviewImage(null)} aria-label="Close">&times;</button>
            <img src={previewImage} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

