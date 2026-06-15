import { supabase } from './supabase';

const DB_NAME = 'inspekto-offline';
const DB_VERSION = 2;
const DRAFT_STORE = 'inspectionDrafts';
const QUEUE_STORE = 'inspectionSyncQueue';
const BUSINESS_STORE = 'businessRecords';
const BUSINESS_ADDITIONAL_STORE = 'businessAdditionalRecords';
const INSPECTION_BUCKET = 'inspection';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('Offline storage is not supported by this browser.'));
      return;
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'missionOrderId' });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('missionOrderId', 'missionOrderId', { unique: false });
      }
      if (!db.objectStoreNames.contains(BUSINESS_STORE)) {
        db.createObjectStore(BUSINESS_STORE, { keyPath: 'offlineKey' });
      }
      if (!db.objectStoreNames.contains(BUSINESS_ADDITIONAL_STORE)) {
        db.createObjectStore(BUSINESS_ADDITIONAL_STORE, { keyPath: 'offlineKey' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline storage.'));
  });
}

function runStore(storeName, mode, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let request;

        try {
          request = action(store);
        } catch (e) {
          db.close();
          reject(e);
          return;
        }

        tx.oncomplete = () => {
          db.close();
          resolve(request?.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || request?.error || new Error('Offline storage transaction failed.'));
        };
      })
  );
}

function getAllFromStore(storeName) {
  return runStore(storeName, 'readonly', (store) => store.getAll());
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function businessOfflineKey(row, index = 0) {
  const key =
    row?.business_pk ||
    row?.bin ||
    row?.epermit_no ||
    [row?.business_name, row?.business_address].filter(Boolean).join('|') ||
    `business-${index}`;
  return String(key);
}

function additionalOfflineKey(row, index = 0) {
  const key =
    row?.id ||
    [row?.bin, row?.business_name, row?.line_of_business, row?.total_employees].filter(Boolean).join('|') ||
    `business-additional-${index}`;
  return String(key);
}

function makeQueueId(missionOrderId, action) {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${missionOrderId}-${action}-${random}`;
}

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function isBlobLike(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read offline file data.'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const response = await fetch(dataUrl);
  return response.blob();
}

async function serializeBlobField(source, blobField, dataUrlField, contentTypeField) {
  const next = { ...source };
  if (isBlobLike(next[blobField])) {
    next[dataUrlField] = await blobToDataUrl(next[blobField]);
    if (contentTypeField) next[contentTypeField] = next[contentTypeField] || next[blobField].type || '';
    next[blobField] = null;
  }
  return next;
}

async function hydrateBlobField(source, blobField, dataUrlField, contentTypeField) {
  const next = { ...source };
  if (!next[blobField] && next[dataUrlField]) {
    const blob = await dataUrlToBlob(next[dataUrlField]);
    next[blobField] =
      blob && contentTypeField && next[contentTypeField] && blob.type !== next[contentTypeField]
        ? new Blob([blob], { type: next[contentTypeField] })
        : blob;
  }
  return next;
}

async function serializeDraftForStorage(draft) {
  let next = { ...draft };

  next.evidencePhotos = await Promise.all(
    (next.evidencePhotos || []).map(async (photo) => {
      const serialized = await serializeBlobField(photo, 'blob', 'blobDataUrl', 'contentType');
      return serialized;
    })
  );

  next = await serializeBlobField(next, 'inspectorSignatureBlob', 'inspectorSignatureDataUrl', 'inspectorSignatureContentType');
  next = await serializeBlobField(next, 'ownerSignatureBlob', 'ownerSignatureDataUrl', 'ownerSignatureContentType');
  next = await serializeBlobField(next, 'signedAttachmentBlob', 'signedAttachmentDataUrl', 'signedAttachmentContentType');

  return next;
}

async function hydrateDraftFromStorage(draft) {
  if (!draft) return null;
  let next = { ...draft };

  next.evidencePhotos = await Promise.all(
    (next.evidencePhotos || []).map(async (photo) => hydrateBlobField(photo, 'blob', 'blobDataUrl', 'contentType'))
  );

  next = await hydrateBlobField(next, 'inspectorSignatureBlob', 'inspectorSignatureDataUrl', 'inspectorSignatureContentType');
  next = await hydrateBlobField(next, 'ownerSignatureBlob', 'ownerSignatureDataUrl', 'ownerSignatureContentType');
  next = await hydrateBlobField(next, 'signedAttachmentBlob', 'signedAttachmentDataUrl', 'signedAttachmentContentType');

  return next;
}

function fileNameSafe(value, fallback) {
  const raw = String(value || fallback || 'file').replace(/[^a-z0-9._-]+/gi, '-');
  return raw.replace(/^-+|-+$/g, '') || fallback || 'file';
}

async function uploadBlob({ reportId, kind, blob, ts, contentType, existingPath }) {
  if (existingPath) return existingPath;
  if (!blob) return null;

  const ext = String(contentType || blob.type || '').includes('png') ? 'png' : 'jpg';
  const name =
    kind === 'evidence'
      ? `evidence-${fileNameSafe(ts || Date.now(), 'photo')}.${ext}`
      : `${fileNameSafe(kind, 'signature')}.${ext}`;
  const path =
    kind === 'evidence'
      ? `inspection-reports/${reportId}/evidence/${name}`
      : `inspection-reports/${reportId}/signatures/${name}`;

  const { error } = await supabase.storage.from(INSPECTION_BUCKET).upload(path, blob, {
    contentType: contentType || blob.type || undefined,
    upsert: true,
  });

  if (error) throw error;
  return path;
}

export async function saveInspectionDraft(draft) {
  const now = new Date().toISOString();
  const record = await serializeDraftForStorage({
    ...draft,
    updatedAt: now,
    syncStatus: draft.syncStatus || 'draft',
  });
  await runStore(DRAFT_STORE, 'readwrite', (store) => store.put(record));
  return {
    ...draft,
    updatedAt: now,
    syncStatus: draft.syncStatus || 'draft',
  };
}

export async function getInspectionDraft(missionOrderId) {
  if (!missionOrderId) return null;
  const record = await runStore(DRAFT_STORE, 'readonly', (store) => store.get(missionOrderId));
  return hydrateDraftFromStorage(record);
}

export async function deleteInspectionDraft(missionOrderId) {
  if (!missionOrderId) return;
  await runStore(DRAFT_STORE, 'readwrite', (store) => store.delete(missionOrderId));
}

export async function saveOfflineBusinessRecords({ businesses = [], additional = [] } = {}) {
  const savedAt = new Date().toISOString();

  for (const [index, row] of (businesses || []).entries()) {
    if (!row) continue;
    await runStore(BUSINESS_STORE, 'readwrite', (store) =>
      store.put({
        ...row,
        offlineKey: businessOfflineKey(row, index),
        offlineSavedAt: savedAt,
      })
    );
  }

  for (const [index, row] of (additional || []).entries()) {
    if (!row) continue;
    await runStore(BUSINESS_ADDITIONAL_STORE, 'readwrite', (store) =>
      store.put({
        ...row,
        offlineKey: additionalOfflineKey(row, index),
        offlineSavedAt: savedAt,
      })
    );
  }
}

export async function searchOfflineBusinesses(query, limit = 5) {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const rows = await getAllFromStore(BUSINESS_STORE);
  return (rows || [])
    .filter((row) =>
      [row?.bin, row?.epermit_no, row?.business_name, row?.business_address, row?.owner_name]
        .map(normalizeSearchText)
        .some((value) => value.includes(q))
    )
    .slice(0, limit);
}

export async function getOfflineBusinessAdditional({ bin, businessName } = {}) {
  const normalizedBin = normalizeSearchText(bin);
  const normalizedName = normalizeSearchText(businessName);
  if (!normalizedBin && !normalizedName) return [];

  const rows = await getAllFromStore(BUSINESS_ADDITIONAL_STORE);
  return (rows || []).filter((row) => {
    const rowBin = normalizeSearchText(row?.bin);
    const rowName = normalizeSearchText(row?.business_name);
    return (normalizedBin && rowBin === normalizedBin) || (normalizedName && rowName === normalizedName);
  });
}

export async function enqueueInspectionSync({ action, draft }) {
  const now = new Date().toISOString();
  const existingQueue = await getInspectionSyncQueue();
  const staleItems = existingQueue.filter(
    (item) =>
      item.missionOrderId === draft.missionOrderId &&
      item.status !== 'synced' &&
      (item.action === action || action === 'submit')
  );

  for (const item of staleItems) {
    await runStore(QUEUE_STORE, 'readwrite', (store) => store.delete(item.id));
  }

  const item = {
    id: makeQueueId(draft.missionOrderId, action),
    missionOrderId: draft.missionOrderId,
    inspectionReportId: draft.inspectionReportId,
    action,
    draft: await serializeDraftForStorage(draft),
    status: 'queued',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    lastError: '',
  };

  await runStore(QUEUE_STORE, 'readwrite', (store) => store.put(item));
  await saveInspectionDraft({ ...draft, syncStatus: action === 'submit' ? 'ready_to_sync' : 'draft' });
  return item;
}

export async function getInspectionSyncQueue() {
  const rows = await getAllFromStore(QUEUE_STORE);
  const hydrated = await Promise.all(
    (rows || []).map(async (row) => ({
      ...row,
      draft: await hydrateDraftFromStorage(row.draft),
    }))
  );
  return hydrated.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function getPendingInspectionSyncCount() {
  const rows = await getInspectionSyncQueue();
  return rows.filter((row) => row.status === 'queued' || row.status === 'failed').length;
}

async function updateQueueItem(item, patch) {
  const next = {
    ...item,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const stored = {
    ...next,
    draft: await serializeDraftForStorage(next.draft),
  };
  await runStore(QUEUE_STORE, 'readwrite', (store) => store.put(stored));
  return next;
}

async function syncQueueItem(item) {
  if (!isOnline()) {
    throw new Error('Device is offline.');
  }

  const draft = item.draft;
  const reportId = draft.inspectionReportId;
  if (!draft.missionOrderId || !reportId) {
    throw new Error('Offline inspection draft is missing its mission order or report id.');
  }

  const { data: currentReport, error: reportCheckError } = await supabase
    .from('inspection_reports')
    .select('id, status, completed_at')
    .eq('mission_order_id', draft.missionOrderId)
    .maybeSingle();

  if (reportCheckError) throw reportCheckError;
  if (currentReport?.status === 'completed') {
    throw new Error('This inspection report was already completed online. Please review it before syncing offline changes.');
  }

  const attachmentUrls = [];
  for (const photo of draft.evidencePhotos || []) {
    const path = await uploadBlob({
      reportId,
      kind: 'evidence',
      blob: photo.blob,
      ts: photo.ts,
      contentType: photo.contentType || photo.blob?.type || 'image/jpeg',
      existingPath: photo.storagePath,
    });
    if (path) attachmentUrls.push(path);
  }

  const inspectorSignaturePath = await uploadBlob({
    reportId,
    kind: 'inspector-signature',
    blob: draft.inspectorSignatureBlob,
    contentType: draft.inspectorSignatureContentType || draft.inspectorSignatureBlob?.type || 'image/png',
    existingPath: draft.inspectorSignaturePath,
  });

  const ownerSignaturePath = await uploadBlob({
    reportId,
    kind: 'owner-signature',
    blob: draft.ownerSignatureBlob,
    contentType: draft.ownerSignatureContentType || draft.ownerSignatureBlob?.type || 'image/png',
    existingPath: draft.ownerSignaturePath,
  });

  const payload = {
    ...draft.reportPayload,
    attachment_urls: attachmentUrls.length ? attachmentUrls : null,
    inspector_signature_url: inspectorSignaturePath || null,
    owner_signature_url: ownerSignaturePath || null,
  };

  const { error: updateError } = await supabase
    .from('inspection_reports')
    .update(payload)
    .eq('mission_order_id', draft.missionOrderId);

  if (updateError) throw updateError;

  if (item.action === 'submit') {
    const completedAt = draft.completedAt || new Date().toISOString();
    const { error: submitError } = await supabase
      .from('inspection_reports')
      .update({
        status: 'completed',
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('mission_order_id', draft.missionOrderId);
    if (submitError) throw submitError;

    if (draft.complaintId) {
      const { error: complaintError } = await supabase
        .from('complaints')
        .update({
          status: 'completed',
          updated_at: completedAt,
        })
        .eq('id', draft.complaintId);
      if (complaintError) throw complaintError;
    }

    const { error: missionOrderError } = await supabase
      .from('mission_orders')
      .update({
        status: 'complete',
        updated_at: completedAt,
      })
      .eq('id', draft.missionOrderId);
    if (missionOrderError) throw missionOrderError;
  }

  await updateQueueItem(item, { status: 'synced', lastError: '' });
  await deleteInspectionDraft(draft.missionOrderId);
}

export async function syncPendingInspectionReports() {
  if (!isOnline()) return { synced: 0, failed: 0, skipped: true };

  const rows = await getInspectionSyncQueue();
  const pending = rows.filter((row) => row.status === 'queued' || row.status === 'failed');
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    let current = item;
    try {
      current = await updateQueueItem(item, { status: 'syncing', lastError: '' });
      await syncQueueItem(current);
      synced += 1;
    } catch (e) {
      failed += 1;
      await updateQueueItem(current, {
        status: 'failed',
        retryCount: (current.retryCount || 0) + 1,
        lastError: e?.message || 'Sync failed.',
      });
    }
  }

  return { synced, failed, skipped: false };
}
