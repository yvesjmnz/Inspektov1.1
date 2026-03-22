import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';

function safeText(v) {
  return String(v ?? '').trim();
}

function formatChecklistStatus(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'compliant') return 'Compliant';
  if (normalized === 'non_compliant') return 'Non-Compliant';
  return 'N/A';
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

async function cropSignatureBase64(base64) {
  const buffer = base64ToArrayBuffer(base64);
  if (!buffer) return base64;

  const blob = new Blob([buffer], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load signature image.'));
      img.src = objectUrl;
    });

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) return base64;

    sourceCtx.drawImage(image, 0, 0);
    const { data, width, height } = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const isVisibleStroke = alpha > 16 && !(r > 245 && g > 245 && b > 245);

        if (!isVisibleStroke) continue;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return base64;

    const padding = 6;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + padding * 2);

    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = cropW;
    targetCanvas.height = cropH;
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) return base64;

    targetCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const croppedBlob = await new Promise((resolve) => targetCanvas.toBlob(resolve, 'image/png'));
    if (!croppedBlob) return base64;

    return arrayBufferToBase64(await croppedBlob.arrayBuffer());
  } catch {
    return base64;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
    return `${label}: ${formatChecklistStatus(status)}`;
  };

  const lines = [
    toFindingText('Business Permit (Presented)', business_permit_status),
    toFindingText('With CCTV', cctv_status),
    toFindingText('Signage', signage_status),
  ];

  const cctvCountNum = Number(cctv_count);
  if (Number.isFinite(cctvCountNum) && cctvCountNum > 0) {
    lines.splice(1, 1, `With CCTV: ${formatChecklistStatus(cctv_status)} (${cctvCountNum} CCTV${cctvCountNum === 1 ? '' : 's'})`);
  }

  const signageSqmNum = Number(signage_sqm);
  if (Number.isFinite(signageSqmNum) && signageSqmNum > 0) {
    lines.splice(2, 1, `Signage: ${formatChecklistStatus(signage_status)} (${signageSqmNum} sqm)`);
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

function moveBinAndAddressToLeftCell(zip) {
  const entry = zip.file('word/document.xml');
  if (!entry) return;

  const xml = entry.asText();
  const rowPattern = /<w:tr\b[\s\S]*?NAME OF OWNER:[\s\S]*?BIN:[\s\S]*?EMAIL ADDRESS:[\s\S]*?<\/w:tr>/;
  const rowMatch = xml.match(rowPattern);
  if (!rowMatch) return;

  const rowXml = rowMatch[0];
  const cellMatches = rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
  if (!Array.isArray(cellMatches) || cellMatches.length < 2) return;

  const leftCellXml = cellMatches.find((cellXml) => cellXml.includes('NAME OF OWNER:'));
  const rightCellXml = cellMatches.find((cellXml) => cellXml.includes('BIN:'));
  if (!leftCellXml || !rightCellXml) return;

  const extractParagraphByLabel = (cellXml, label) => {
    const paragraphMatches = cellXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    return paragraphMatches.find((paragraphXml) => paragraphXml.includes(label)) || null;
  };

  const businessNameParagraphXml = extractParagraphByLabel(leftCellXml, 'BUSINESS NAME:');
  const binParagraphXml = extractParagraphByLabel(rightCellXml, 'BIN:');
  const addressParagraphXml = extractParagraphByLabel(rightCellXml, 'ADDRESS:');

  if (!businessNameParagraphXml || !binParagraphXml || !addressParagraphXml) return;

  const movedParagraphsXml = `${binParagraphXml}${addressParagraphXml}`;
  const nextLeftCellXml = leftCellXml.replace(businessNameParagraphXml, `${businessNameParagraphXml}${movedParagraphsXml}`);
  const nextRightCellXml = rightCellXml
    .replace(binParagraphXml, '')
    .replace(addressParagraphXml, '');
  const nextRowXml = rowXml.replace(leftCellXml, nextLeftCellXml).replace(rightCellXml, nextRightCellXml);

  zip.file('word/document.xml', xml.replace(rowXml, nextRowXml));
}

function applyFontSizeToRuns(xmlFragment, halfPointValue) {
  const sizeTag = `<w:sz w:val="${halfPointValue}"/><w:szCs w:val="${halfPointValue}"/>`;

  return String(xmlFragment || '').replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (runXml, attrs, inner) => {
    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(runXml)) {
      return runXml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_match, props) => {
        const cleanedProps = String(props || '')
          .replace(/<w:sz\b[^>]*\/>/g, '')
          .replace(/<w:szCs\b[^>]*\/>/g, '');
        return `<w:rPr>${cleanedProps}${sizeTag}</w:rPr>`;
      });
    }

    return `<w:r${attrs || ''}><w:rPr>${sizeTag}</w:rPr>${inner}</w:r>`;
  });
}

function shrinkFindingsSection(zip, halfPointValue = 20) {
  const entry = zip.file('word/document.xml');
  if (!entry) return;

  const xml = entry.asText();
  const startAnchor = 'Business Permit (Presented):';
  const endAnchor = 'BUSINESS OWNER/REPRESENTATIVE:';
  const startAnchorIndex = xml.indexOf(startAnchor);
  const endAnchorIndex = xml.indexOf(endAnchor);

  if (startAnchorIndex === -1 || endAnchorIndex === -1 || endAnchorIndex <= startAnchorIndex) return;

  const middleStart = xml.lastIndexOf('<w:p', startAnchorIndex);
  const middleEnd = xml.lastIndexOf('<w:p', endAnchorIndex);
  if (!Number.isFinite(middleStart) || !Number.isFinite(middleEnd) || middleEnd <= middleStart) return;

  const before = xml.slice(0, middleStart);
  const middle = xml.slice(middleStart, middleEnd);
  const after = xml.slice(middleEnd);
  const resizedMiddle = applyFontSizeToRuns(middle, halfPointValue);

  zip.file('word/document.xml', `${before}${resizedMiddle}${after}`);
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
      return [118, 28];
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
      inspectorSignatureBase64 = await cropSignatureBase64(arrayBufferToBase64(buf));
    } catch {
      inspectorSignatureBase64 = null;
    }
  }

  let ownerSignatureBase64 = null;
  if (owner_signature_url) {
    try {
      const buf = await fetchAsArrayBuffer(owner_signature_url);
      ownerSignatureBase64 = await cropSignatureBase64(arrayBufferToBase64(buf));
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
  const businessPermitDisplay = formatChecklistStatus(business_permit_status);
  const cctvStatusDisplay = formatChecklistStatus(cctv_status);
  const signageStatusDisplay = formatChecklistStatus(signage_status);

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
    business_permit_status: businessPermitDisplay,
    cctv_status: cctvStatusDisplay,
    signage_status: signageStatusDisplay,
    cctv_count: Number(cctv_count) || 0,

    // Aliases (in case the template uses shorter placeholder names)
    business_permit: businessPermitDisplay,
    with_cctv: cctvStatusDisplay,
    signage_2sqm: signageStatusDisplay,
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

  moveBinAndAddressToLeftCell(doc.getZip());
  shrinkFindingsSection(doc.getZip(), 20);

  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

