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
        setContent(data?.content || '<p><strong>MISSION ORDER</strong></p><p>Start typing…</p>');
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
              dangerouslySetInnerHTML={{ __html: content }}
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
