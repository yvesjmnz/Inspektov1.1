/**
 * Batch Geocoding Admin Page
 * 
 * Allows admins to run batch geocoding job to populate missing business coordinates
 */

import { useEffect, useState } from 'react';
import {
  runBatchGeocoding,
  runFullBatchGeocoding,
  getBusinessesNeedingGeocoding,
} from '../../../lib/geocoding/batchGeocoding';

export default function BatchGeocodingAdmin() {
  const [needsGeocoding, setNeedsGeocoding] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('batch'); // 'batch' or 'full'
  const [dryRun, setDryRun] = useState(false);

  // Get count on mount
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const count = await getBusinessesNeedingGeocoding();
        setNeedsGeocoding(count);
      } catch (err) {
        console.error('Error fetching count:', err);
      }
    };

    fetchCount();
  }, []);

  const handleRunBatch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (mode === 'batch') {
        const res = await runBatchGeocoding({ limit: 1000, offset: 0, dryRun });
        setResult(res);
      } else {
        // Full batch with progress
        await runFullBatchGeocoding((progress) => {
          setResult(progress);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h1>Batch Geocoding Admin</h1>

      <div style={{ marginBottom: '24px', padding: '16px', background: '#f0f9ff', borderRadius: '8px' }}>
        <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#64748b' }}>
          Businesses needing geocoding:
        </p>
        <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#0f172a' }}>
          {needsGeocoding}
        </p>
      </div>

      <div style={{ marginBottom: '24px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Options</h3>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              value="batch"
              checked={mode === 'batch'}
              onChange={(e) => setMode(e.target.value)}
              disabled={loading}
            />
            <span>Batch Mode (50 at a time)</span>
          </label>
          <p style={{ margin: '4px 0 0 28px', fontSize: '12px', color: '#64748b' }}>
            Process 50 businesses per request. Useful for testing or partial updates.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              value="full"
              checked={mode === 'full'}
              onChange={(e) => setMode(e.target.value)}
              disabled={loading}
            />
            <span>Full Mode (all businesses)</span>
          </label>
          <p style={{ margin: '4px 0 0 28px', fontSize: '12px', color: '#64748b' }}>
            Process all businesses with missing coordinates. May take several minutes.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={loading}
            />
            <span>Dry Run (preview only, no updates)</span>
          </label>
        </div>

        <button
          onClick={handleRunBatch}
          disabled={loading || needsGeocoding === 0}
          style={{
            padding: '10px 16px',
            background: loading ? '#cbd5e1' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {loading ? 'Processing...' : 'Run Geocoding'}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: '24px', padding: '16px', background: '#fee2e2', borderRadius: '8px', color: '#991b1b' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ marginBottom: '24px', padding: '16px', background: '#f0fdf4', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0, color: '#166534' }}>Results</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <div style={{ padding: '12px', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#64748b' }}>Processed</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>
                {result.processed}
              </p>
            </div>

            <div style={{ padding: '12px', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#64748b' }}>Updated</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#16a34a' }}>
                {result.updated}
              </p>
            </div>

            <div style={{ padding: '12px', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#64748b' }}>Failed</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#dc2626' }}>
                {result.failed}
              </p>
            </div>
          </div>

          {result.errors && result.errors.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#991b1b' }}>Errors ({result.errors.length})</h4>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#7f1d1d' }}>
                {result.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {result.errors.length > 10 && <li>... and {result.errors.length - 10} more</li>}
              </ul>
            </div>
          )}

          {result.details && result.details.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 8px 0' }}>Details</h4>
              <div style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Business</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.details.map((detail, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '8px' }}>{detail.business_name}</td>
                        <td style={{ padding: '8px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background:
                                detail.status === 'success'
                                  ? '#dcfce7'
                                  : detail.status === 'failed'
                                    ? '#fee2e2'
                                    : '#f3f4f6',
                              color:
                                detail.status === 'success'
                                  ? '#166534'
                                  : detail.status === 'failed'
                                    ? '#991b1b'
                                    : '#64748b',
                            }}
                          >
                            {detail.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px', color: '#991b1b' }}>{detail.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
