import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './MissionOrderEditor.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

export default function MissionOrderEditor() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const editorRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!missionOrderId) {
        setError('Missing mission order id. Open this page as /mission-order?id=<uuid>');
        return;
      }

      setError('');
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from('mission_orders')
          .select('id, title, content, complaint_id, created_at, updated_at')
          .eq('id', missionOrderId)
          .single();

        if (error) throw error;
        if (!mounted) return;

        setTitle(data?.title || `Mission Order ${String(data?.id || '').slice(0, 8)}…`);
        setContent(
          data?.content ||
            [
              '<div style="font-family: serif; line-height: 1.5;">',
              '<p style="text-align:center; font-size: 18px;"><strong>MISSION ORDER</strong></p>',
              '<br/>',
              '<p><strong>TO:</strong> FIELD INSPECTOR [INSPECTOR NAME]</p>',
              '<p><strong>SUBJECT:</strong> TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS [BUSINESS NAME] WITH ADDRESS AT [ADDRESS]</p>',
              '<p><strong>DATE OF INSPECTION: </strong>[INSERT DATE]</p>',
              '<p><strong>DATE OF ISSUANCE: </strong>[INSERT DATE]</p>',
              '<br/>',
              '<p style="text-align:justify;">In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:</p>',
              
              // Tabbed List using padding-left
              '<p style="text-align:justify; padding-left: 40px;">a) To verify the existence and authenticity of the Business Permits and other applicable permits, certificates, and other necessary documents, the completeness of the requirements therein.</p>',
              '<p style="text-align:justify; padding-left: 40px;">b) To check actual business operation of the subject establishment.</p>',
              '<p style="text-align:justify; padding-left: 40px;">c) To check compliance of said establishment with existing laws, ordinance, regulations relative to health & sanitation, fire safety, engineering & electrical installation standards.</p>',
              
              '<br/>',
              '<p style="text-align:justify;">You are hereby directed to identify yourself by showing proper identification and act with due courtesy and politeness in the implementation of this Order. All inspectors shall wear their IDs in such manner as the public will be informed of their true identity.</p>',
              '<br/>',
              '<p style="text-align:justify;"><strong>You should also inform the owner or representative of the establishment being inspected that they may verify the authenticity of this Mission Order, or ask questions, or lodge complaints, thru our telephone number (02) 8527-0871 or email at permits@manila.gov.ph</strong></p>',
              '<br/>',
              '<p style="text-align:justify;">This Order is in effect until [INSERT DATE] and any Order inconsistent herewith is hereby revoked and/or amended accordingly.</p>',
              '<br/><br/>',

              // Signature Table for side-by-side names
              '<table style="width: 100%; border: none; border-collapse: collapse;">',
                '<tr>',
                  '<td style="width: 50%; vertical-align: top;">',
                    '<p style="margin: 0;">Recommending approval:</p>',
                    '<br/><br/>',
                    '<p style="margin: 0;"><strong>LEVI FACUNDO</strong></p>',
                    '<p style="margin: 0;">Director</p>',
                  '</td>',
                  '<td style="width: 50%; vertical-align: top;">',
                    '<p style="margin: 0;">Approved by:</p>',
                    '<br/><br/>',
                    '<p style="margin: 0;"><strong>MANUEL M. ZARCAL</strong></p>',
                    '<p style="margin: 0;">Secretary to the Mayor</p>',
                  '</td>',
                '</tr>',
              '</table>',
              '</div>'
            ].join('')
        );
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [missionOrderId]);

  // Keep the editable DOM in sync when content changes (initial load)
  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content;
    }
  }, [content]);

  const handleSave = async () => {
    if (!missionOrderId) return;

    setError('');
    setToast('');
    setSaving(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const html = editorRef.current?.innerHTML ?? '';

      const { error } = await supabase
        .from('mission_orders')
        .update({
          title: title || null,
          content: html,
          last_edited_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', missionOrderId);

      if (error) throw error;

      setToast('Saved.');
    } catch (e) {
      setError(e?.message || 'Failed to save mission order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mo-container">
      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <label className="mo-label" htmlFor="moTitle">Title</label>
              <input
                id="moTitle"
                className="mo-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mission Order Title"
                disabled={loading}
              />
              <div className="mo-meta">
                <span>MO ID: {missionOrderId ? `${missionOrderId.slice(0, 8)}…` : '—'}</span>
              </div>
            </div>

            <div className="mo-actions">
              <a className="mo-link" href="/dashboard/head-inspector">Back</a>
              <button className="mo-btn" type="button" onClick={handleSave} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          <div className="mo-editor-wrap">
            <div
              ref={editorRef}
              className="mo-editor"
              contentEditable={!loading}
              suppressContentEditableWarning
              // Don't use dangerouslySetInnerHTML here; we manually sync innerHTML only when loading initial content.
              // Re-rendering innerHTML on each keystroke resets the caret to the beginning.
              onInput={() => setContent(editorRef.current?.innerHTML ?? '')}
            />
          </div>

          <div className="mo-note">
            This is a simple editable document stored in <code>mission_orders.content</code>.
            Next we can add a richer editor (TipTap/Quill) and a print/PDF layout.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
