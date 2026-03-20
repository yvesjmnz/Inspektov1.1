import React from 'react';

// Shared Mission Order History view used by Head Inspector and Director
// Props expected:
// - missionOrdersByDay: { groups: { [dayKey]: { label, items } }, sortedKeys: [] }
// - expandedComplaintId, setExpandedComplaintId
// - onRowClick(mo) -> navigate
// - formatStatus, statusBadgeClass (helpers)

function fmtFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function renderInspectorPills(inspectorNames, keyPrefix) {
  const names = Array.isArray(inspectorNames) ? inspectorNames.filter(Boolean) : [];
  const visibleNames = names.slice(0, 2);
  const hiddenNames = names.slice(2);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
      {names.length === 0 ? (
        <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
      ) : (
        <>
          {visibleNames.map((name, idx) => (
            <span key={`${keyPrefix}-${idx}`} style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}>
              {name}
            </span>
          ))}
          {hiddenNames.length > 0 ? (
            <span
              title={hiddenNames.join(', ')}
              style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 800, border: '1px solid #cbd5e1', background: '#e2e8f0', color: '#334155', fontSize: 11 }}
            >
              +{hiddenNames.length}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function MissionOrderHistory({ missionOrdersByDay, expandedComplaintId, setExpandedComplaintId, onRowClick, formatStatus, statusBadgeClass }) {
  if (!missionOrdersByDay || !missionOrdersByDay.sortedKeys || missionOrdersByDay.sortedKeys.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        No mission orders found.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {missionOrdersByDay.sortedKeys.map((dayKey) => {
        const dayGroup = missionOrdersByDay.groups[dayKey];
        const count = dayGroup?.items?.length || 0;
        if (count === 0) return null;

        return (
          <div key={`day-card-${dayKey}`} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 4px 12px rgba(2,6,23,0.08)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>
                {new Date(dayKey).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', flexShrink: 0 }}></div>
                <span style={{ color: '#d1fae5' }}>{count} Completed Mission Order{count !== 1 ? 's' : ''}</span>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                    <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mission Order</th>
                    <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Inspection Date</th>
                    <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Inspectors</th>
                  </tr>
                </thead>
                <tbody>
                  {dayGroup.items.map((mo) => (
                    <React.Fragment key={mo.complaint_id || mo.mission_order_id}>
                      <tr
                        key={mo.mission_order_id}
                        onClick={() => onRowClick(mo)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #e2e8f0', transition: 'background-color 0.2s ease', position: 'relative' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}
                      >
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedComplaintId(expandedComplaintId === mo.complaint_id ? null : mo.complaint_id); }} style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, color: '#64748b', transition: 'transform 0.3s', transform: expandedComplaintId === mo.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}>
                            <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </td>
                        <td>
                          <span className={statusBadgeClass(mo.mission_order_status || mo.status)}>{formatStatus(mo.mission_order_status || mo.status)}</span>
                        </td>
                        <td>
                          <div className="dash-cell-title">{mo.business_name || mo.title || 'Mission Order'}</div>
                          <div className="dash-cell-sub">{mo.business_address || (mo.complaint_id ? (`Complaint: ${String(mo.complaint_id).slice(0, 8)}…`) : '')}</div>
                        </td>
                        <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                          {mo.date_of_inspection ? new Date(mo.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td>{renderInspectorPills(mo.inspector_names, mo.complaint_id || mo.mission_order_id || 'mo')}</td>
                      </tr>

                      {expandedComplaintId === mo.complaint_id && (
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                          <td colSpan="5" style={{ padding: '16px 24px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {(() => {
                                const events = [];
                                if (mo.created_at) events.push({ ts: mo.created_at, title: 'Complaint Submitted', email: mo.reporter_email || null });
                                if (mo.approved_at) events.push({ ts: mo.approved_at, title: 'Complaint Approved' });
                                if (mo.mission_order_created_at) events.push({ ts: mo.mission_order_created_at, title: 'Mission Order Created' });
                                if (mo.director_preapproved_at) events.push({ ts: mo.director_preapproved_at, title: 'Mission Order Pre-Approved by Director' });
                                if (mo.secretary_signed_at) events.push({ ts: mo.secretary_signed_at, title: 'Mission Order Signed by Secretary' });

                                events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

                                return events.length === 0 ? (
                                  <div style={{ padding: 12, color: '#64748b' }}>No timeline available.</div>
                                ) : (
                                  events.map((ev, i) => (
                                    <div key={`ev-${i}`} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>{fmtFull(ev.ts)}</div>
                                      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                        {ev.title}{ev.email ? ' by ' : null}{ev.email ? <span style={{ fontWeight: 700 }}>{ev.email}</span> : null}
                                      </div>
                                    </div>
                                  ))
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
