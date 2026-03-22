import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';

function safeText(v) {
  return String(v ?? '').trim();
}

function truncateAddressAtNcr(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const idx = upper.indexOf(', NCR');
  if (idx === -1) return s;
  return s.slice(0, idx).trim();
}

function humanDate(value) {
  const s = safeText(value);
  if (!s) return '—';

  // Accept YYYY-MM-DD or ISO strings.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function humanTime(value) {
  const s = safeText(value);
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch template/resource: ${url}`);
  return await res.arrayBuffer();
}

function arrayBufferToBase64(buf) {
  if (!buf) return '';
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  if (!(bytes instanceof Uint8Array)) return '';

  // Convert in chunks to avoid call stack issues with very large buffers.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const clean = String(b64 || '').trim().replace(/^data:.*;base64,/, '');
  if (!clean) return null;
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function buildFindingsLines({
  business_permit_status,
  cctv_status,
  signage_status,
  cctv_count,
  signage_sqm,
  inspection_remarks,
}) {
  const toFindingText = (label, status) => {
    const s = safeText(status);
    if (!s) return `${label}: N/A`;
    return `${label}: ${s}`;
  };

  const lines = [
    toFindingText('Business Permit (Presented)', business_permit_status),
    toFindingText('With CCTV', cctv_status),
    toFindingText('Signage', signage_status),
  ];

  const cctvCountNum = Number(cctv_count);
  if (Number.isFinite(cctvCountNum) && cctvCountNum > 0) {
    lines.splice(1, 1, `With CCTV: ${safeText(cctv_status) || 'N/A'} (${cctvCountNum} CCTV${cctvCountNum === 1 ? '' : 's'})`);
  }

  const signageSqmNum = Number(signage_sqm);
  if (Number.isFinite(signageSqmNum) && signageSqmNum > 0) {
    lines.splice(2, 1, `Signage: ${safeText(signage_status) || 'N/A'} (${signageSqmNum} sqm)`);
  }

  const remarks = safeText(inspection_remarks);
  if (remarks) {
    lines.push('', `Remarks: ${remarks}`);
  }

  return lines.join('\n');
}

function ensureEstimatedAreaPlaceholder(zip) {
  const entry = zip.file('word/document.xml');
  if (!entry) return;

  const xml = entry.asText();
  const paragraphPattern = /(<w:p\b[^>]*>[\s\S]*?<w:t>ESTIMATED AREA \(IN SQM\):<\/w:t>[\s\S]*?)(<\/w:p>)/;
  const match = xml.match(paragraphPattern);
  if (!match) return;

  const paragraphXml = match[1];
  if (paragraphXml.includes('{estimated_area_sqm}')) return;

  const injectedParagraph =
    `${paragraphXml}<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/></w:rPr><w:t>{estimated_area_sqm}</w:t></w:r>`;

  zip.file('word/document.xml', xml.replace(paragraphPattern, `${injectedParagraph}$2`));
}

export async function generateInspectionSlipDocx({
  templateUrl,
  owner_name,
  business_name,
  date_of_inspection,
  time_of_inspection,
  inspection_report_id,
  bin,
  business_address,
  estimated_area_sqm,
  number_of_employees,
  landline_no,
  email_address,
  inspector_names,
  // Findings / checklist
  business_permit_status,
  cctv_status,
  signage_status,
  cctv_count,
  signage_sqm,
  inspection_remarks,
  // Optional signatures (image placeholders)
  inspector_signature_url,
  owner_signature_url,
}) {
  if (!templateUrl) throw new Error('Missing inspection-slip DOCX templateUrl.');

  const templateBuf = await fetchAsArrayBuffer(templateUrl);
  const zip = new PizZip(templateBuf);
  ensureEstimatedAreaPlaceholder(zip);

  // Image placeholders (if present in template).
  const imageModuleName = 'open-xml-templating/docxtemplater-image-module';
  const imageModule = new ImageModule({
    centered: false,
    // Allow our signature placeholders to work even if the DOCX uses plain `{{owner_signature_url}}`
    // instead of `%owner_signature_url` / `%%owner_signature_url`.
    setParser: (placeHolderContent) => {
      const raw = String(placeHolderContent || '');
      const trimmed = raw.trim();
      if (!trimmed) return null;

      // Respect the module's native syntax first.
      if (trimmed.substring(0, 2) === '%%') {
        return { type: 'placeholder', value: trimmed.substr(2), module: imageModuleName, centered: true };
      }
      if (trimmed.substring(0, 1) === '%') {
        return { type: 'placeholder', value: trimmed.substr(1), module: imageModuleName, centered: false };
      }

      // Treat signature keys as images even without the '%' prefix.
      const signatureKeys = new Set(['inspector_signature', 'owner_signature', 'inspector_signature_url', 'owner_signature_url']);
      if (signatureKeys.has(trimmed)) {
        return { type: 'placeholder', value: trimmed, module: imageModuleName, centered: false };
      }

      return null;
    },
    getImage: (tag) => {
      // tag is the value passed in the data map.
      // We pass base64 strings (preferred), but we also support ArrayBuffer / typed array bytes.
      if (!tag) return null;
      if (typeof tag === 'string') {
        const maybeB64 = String(tag).trim();
        // base64 or data URL
        if (maybeB64) return base64ToArrayBuffer(maybeB64);
      }
      if (tag instanceof ArrayBuffer) return tag;

      // docxtemplater-image-module-free may give us a typed array / Buffer.
      if (ArrayBuffer.isView(tag)) {
        const view = tag;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }

      return null;
    },
    getSize: () => {
      // Keep signatures compact so the generated inspection slip stays on one page more reliably.
      return [140, 50];
    },
  });

  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  // Pre-fetch signature bytes so docxtemplater-image-module receives bytes.
  let inspectorSignatureBase64 = null;
  if (inspector_signature_url) {
    try {
      const buf = await fetchAsArrayBuffer(inspector_signature_url);
      inspectorSignatureBase64 = arrayBufferToBase64(buf);
    } catch {
      inspectorSignatureBase64 = null;
    }
  }

  let ownerSignatureBase64 = null;
  if (owner_signature_url) {
    try {
      const buf = await fetchAsArrayBuffer(owner_signature_url);
      ownerSignatureBase64 = arrayBufferToBase64(buf);
    } catch {
      ownerSignatureBase64 = null;
    }
  }

  const findings_lines = buildFindingsLines({
    business_permit_status,
    cctv_status,
    signage_status,
    cctv_count,
    signage_sqm,
    inspection_remarks,
  });

  const owner = safeText(owner_name) || '—';
  const truncatedBusinessAddress = truncateAddressAtNcr(business_address);
  const estimatedAreaDisplay = estimated_area_sqm == null || String(estimated_area_sqm).trim() === '' ? '—' : String(estimated_area_sqm).trim();
  const employeesDisplay = number_of_employees == null || String(number_of_employees).trim() === '' ? '—' : String(number_of_employees).trim();

  const docData = {
    // Core identity
    owner_name: owner,
    owner_full_name: owner,
    owner,

    business_name: safeText(business_name) || '—',
    business_address: safeText(truncatedBusinessAddress) || '—',
    address: safeText(truncatedBusinessAddress) || '—',

    // Inspection metadata
    date_of_inspection: humanDate(date_of_inspection),
    time_of_inspection: humanTime(time_of_inspection),

    inspection_report_id: safeText(inspection_report_id) || '—',
    report_id: safeText(inspection_report_id) || '—',

    // Contact / identifiers
    bin: safeText(bin) || '—',
    landline_no: safeText(landline_no) || '—',
    landline: safeText(landline_no) || '—',
    number_of_employees: employeesDisplay,
    no_of_employees: employeesDisplay,
    employees: employeesDisplay,
    employee_count: employeesDisplay,
    estimated_area_sqm: estimatedAreaDisplay,
    estimated_area: estimatedAreaDisplay,
    area_in_sqm: estimatedAreaDisplay,
    estimated_area_in_sqm: estimatedAreaDisplay,
    estimated_area_insqm: estimatedAreaDisplay,
    estimated_area_sq_m: estimatedAreaDisplay,
    area_sqm: estimatedAreaDisplay,
    sqm_area: estimatedAreaDisplay,
    estimatedarea: estimatedAreaDisplay,
    estimatedareasqm: estimatedAreaDisplay,
    estimatedareainsqm: estimatedAreaDisplay,
    'estimated_area_(in_sqm)': estimatedAreaDisplay,
    'estimated_area_(sqm)': estimatedAreaDisplay,
    email_address: safeText(email_address) || '—',
    email: safeText(email_address) || '—',

    // Inspector(s)
    inspector_names: safeText(inspector_names) || '—',
    inspectors: safeText(inspector_names) || '—',

    // Findings
    business_permit_status: safeText(business_permit_status) || 'N/A',
    cctv_status: safeText(cctv_status) || 'N/A',
    signage_status: safeText(signage_status) || 'N/A',
    cctv_count: Number(cctv_count) || 0,

    // Aliases (in case the template uses shorter placeholder names)
    business_permit: safeText(business_permit_status) || 'N/A',
    with_cctv: safeText(cctv_status) || 'N/A',
    signage_2sqm: safeText(signage_status) || 'N/A',
    findings_lines,
    findings: findings_lines,
    inspection_remarks: safeText(inspection_remarks) || '—',
    remarks: safeText(inspection_remarks) || '—',
    additional_observations: safeText(inspection_remarks) || '—',
    findings_remarks: safeText(inspection_remarks) || '—',

    // Optional image placeholders (if template uses them)
    inspector_signature: inspectorSignatureBase64,
    owner_signature: ownerSignatureBase64,

    // Alias keys for templates that use a *_url naming convention.
    inspector_signature_url: inspectorSignatureBase64,
    owner_signature_url: ownerSignatureBase64,
  };

  doc.setData(docData);

  try {
    doc.render();
  } catch (e) {
    console.error('Inspection-slip DOCX render failed:', e);
    throw new Error('Failed to render inspection slip DOCX. Check template placeholders.');
  }

  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

