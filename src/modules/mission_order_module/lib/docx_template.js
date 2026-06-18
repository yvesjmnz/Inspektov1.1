import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import QRCode from 'qrcode';

const MISSION_ORDER_QR_IMAGE_PATH = 'word/media/image1.png';
const BLANK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==';
const QR_IMAGE_SIZE_EMU = 914400; // 1 inch, readable for long public DOCX URLs.
const QR_POSITION_H_EMU = 5350000;
const QR_POSITION_V_EMU = 9920000;

function safeText(v) {
  return String(v ?? '').trim();
}

function humanDateFromYmd(ymd) {
  const s = safeText(ymd);
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url}`);
  return await res.arrayBuffer();
}

function base64ToArrayBuffer(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function dataUrlToArrayBuffer(dataUrl) {
  const commaIndex = String(dataUrl || '').indexOf(',');
  if (commaIndex < 0) throw new Error('Invalid QR image data.');
  return base64ToArrayBuffer(dataUrl.slice(commaIndex + 1));
}

function escapeXmlText(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function createBlankPngArrayBuffer() {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) return await blob.arrayBuffer();
  }
  return base64ToArrayBuffer(BLANK_PNG_BASE64);
}

function makeRun(text, { bold = true, size = 24 } = {}) {
  return [
    '<w:r>',
    '<w:rPr>',
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    bold ? '<w:b/><w:bCs/>' : '',
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    '<w:lang w:val="en-PH"/>',
    '</w:rPr>',
    `<w:t xml:space="preserve">${escapeXmlText(text)}</w:t>`,
    '</w:r>',
  ].join('');
}

function makeParagraph(childrenXml, { alignment = null, after = 160, before = 0 } = {}) {
  return [
    '<w:p>',
    '<w:pPr>',
    alignment ? `<w:jc w:val="${alignment}"/>` : '',
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
    '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:bCs/><w:lang w:val="en-PH"/></w:rPr>',
    '</w:pPr>',
    childrenXml,
    '</w:p>',
  ].join('');
}

function makeTextParagraphs(text, { after = 90 } = {}) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  return lines.map((line) => makeParagraph(makeRun(line), { alignment: 'both', after })).join('');
}

function buildDetailsDocumentBodyXml({
  inspectors,
  date_of_inspection,
  date_of_issuance,
  business_name,
  business_address,
  complaint_details,
}) {
  const inspectorText = safeText(inspectors) || '-';
  const businessName = safeText(business_name) || '-';
  const businessAddress = safeText(business_address) || '-';
  const inspectionDate = humanDateFromYmd(date_of_inspection);
  const issuanceDate = humanDateFromYmd(date_of_issuance);
  const complaintDetails = safeText(complaint_details);

  return [
    makeParagraph(makeRun('TO: FIELD INSPECTOR/S'), { after: 80 }),
    makeParagraph(makeRun(inspectorText, { bold: false }), { after: 180 }),
    makeParagraph(
      makeRun(`SUBJECT: TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS ${businessName} WITH ADDRESS AT ${businessAddress}`),
      { alignment: 'both', after: 220 }
    ),
    makeTextParagraphs(complaintDetails, { after: 90 }),
    makeParagraph(makeRun(`DATE OF INSPECTION: ${inspectionDate}`), { after: 180 }),
    makeParagraph(makeRun(`DATE OF ISSUANCE: ${issuanceDate}`), { after: 180 }),
  ].join('');
}

function replaceDocumentBody(documentXml, bodyXml) {
  const bodyOpenMatch = documentXml.match(/<w:body[^>]*>/);
  if (!bodyOpenMatch || typeof bodyOpenMatch.index !== 'number') {
    throw new Error('Mission order template document body was not found.');
  }

  const bodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const bodyEnd = documentXml.indexOf('</w:body>', bodyStart);
  if (bodyEnd < 0) {
    throw new Error('Mission order template document body close tag was not found.');
  }

  const bodyInner = documentXml.slice(bodyStart, bodyEnd);
  const sectPrMatches = Array.from(bodyInner.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g));
  const sectPr = sectPrMatches.length ? sectPrMatches[sectPrMatches.length - 1][0] : '';

  return `${documentXml.slice(0, bodyStart)}${bodyXml}${sectPr}${documentXml.slice(bodyEnd)}`;
}

async function createMissionOrderQrImage({
  mission_order_qr_mode,
  mission_order_qr_url,
}) {
  if (mission_order_qr_mode !== 'generated') {
    return await createBlankPngArrayBuffer();
  }

  const payload = safeText(mission_order_qr_url);
  if (!payload) throw new Error('Mission order QR URL is required.');

  const dataUrl = await QRCode.toDataURL(payload, {
    type: 'image/png',
    errorCorrectionLevel: 'L',
    margin: 2,
    scale: 12,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  return dataUrlToArrayBuffer(dataUrl);
}

function replaceTemplateQrImage(zip, imageBytes, shouldRequireImage) {
  if (!zip.file(MISSION_ORDER_QR_IMAGE_PATH)) {
    if (shouldRequireImage) {
      throw new Error('Mission order template QR image placeholder was not found.');
    }
    return;
  }

  zip.file(MISSION_ORDER_QR_IMAGE_PATH, imageBytes);
}

function adjustQrDrawingPlacement(zip) {
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return;

  const documentXml = documentFile.asText();
  const nextDocumentXml = documentXml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (drawingXml) => {
    if (!drawingXml.includes('r:embed="rId8"')) return drawingXml;

    return drawingXml
      .replace(/<wp:extent cx="[^"]+" cy="[^"]+"\/>/, `<wp:extent cx="${QR_IMAGE_SIZE_EMU}" cy="${QR_IMAGE_SIZE_EMU}"/>`)
      .replace(/<wp:positionH relativeFrom="[^"]+"><wp:posOffset>-?\d+<\/wp:posOffset><\/wp:positionH>/, `<wp:positionH relativeFrom="page"><wp:posOffset>${QR_POSITION_H_EMU}</wp:posOffset></wp:positionH>`)
      .replace(/<wp:positionV relativeFrom="[^"]+"><wp:posOffset>-?\d+<\/wp:posOffset><\/wp:positionV>/, `<wp:positionV relativeFrom="page"><wp:posOffset>${QR_POSITION_V_EMU}</wp:posOffset></wp:positionV>`)
      .replace(/<wp:effectExtent l="[^"]+" t="[^"]+" r="[^"]+" b="[^"]+"\/>/, '<wp:effectExtent l="0" t="0" r="0" b="0"/>')
      .replace(/<a:ext cx="[^"]+" cy="[^"]+"\/>/, `<a:ext cx="${QR_IMAGE_SIZE_EMU}" cy="${QR_IMAGE_SIZE_EMU}"/>`);
  });

  if (nextDocumentXml !== documentXml) {
    zip.file('word/document.xml', nextDocumentXml);
  }
}

export function buildMissionOrderDocxFileName({ business_name, mission_order_id }) {
  const base = safeText(business_name) || 'Mission-Order';
  const safe = base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  const suffix = safeText(mission_order_id) ? `-${safeText(mission_order_id).slice(0, 8)}` : '';
  return `MISSION-ORDER${suffix}-${safe}.docx`;
}

export async function generateMissionOrderDetailsDocx({
  templateUrl = '/MISSION-ORDER-TEMPLATE.docx',
  inspectors,
  date_of_inspection,
  date_of_issuance,
  business_name,
  business_address,
  complaint_details,
}) {
  const templateBuf = await fetchAsArrayBuffer(templateUrl);
  const zip = new PizZip(templateBuf);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Mission order template document XML was not found.');

  const detailsBodyXml = buildDetailsDocumentBodyXml({
    inspectors,
    date_of_inspection,
    date_of_issuance,
    business_name,
    business_address,
    complaint_details,
  });

  const nextDocumentXml = replaceDocumentBody(documentFile.asText(), detailsBodyXml);
  zip.file('word/document.xml', nextDocumentXml);

  return zip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// Generate a DOCX using a .docx template with handlebars-like placeholders
// Required template placeholders:
//   {{inspectors}}, {{date_of_complaint}}, {{date_of_inspection}}, {{date_of_issuance}},
//   {{business_name}}, {{business_address}}, {{complaint_details}}
// Optional image placeholder (if present in template): {{director_signature}}
export async function generateMissionOrderDocx({
  templateUrl = '/MISSION-ORDER-TEMPLATE.docx',
  inspectors,
  date_of_complaint,
  date_of_inspection,
  date_of_issuance,
  business_name,
  business_address,
  complaint_details,
  director_signature_url,
  mission_order_qr_mode = 'blank',
  mission_order_qr_url,
}) {
  // Fetch and load template
  const templateBuf = await fetchAsArrayBuffer(templateUrl);
  const zip = new PizZip(templateBuf);

  const qrImageBytes = await createMissionOrderQrImage({
    mission_order_qr_mode,
    mission_order_qr_url,
  });
  replaceTemplateQrImage(zip, qrImageBytes, mission_order_qr_mode === 'generated');

  // Configure image module (resolves {{director_signature}} to an image if provided)
  const imageModule = new ImageModule({
    centered: false,
    getImage: (tag) => {
      // tag is the value provided in the data for the image placeholder
      if (!tag) return null;
      // We pass bytes (ArrayBuffer) in director_signature.
      if (tag instanceof ArrayBuffer) return tag;
      return null;
    },
    getSize: () => {
      // Default size for e-signature (approx width=220px, height=90px)
      return [220, 90];
    },
  });

  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  // Pre-fetch signature bytes if provided.
  // This avoids the image module receiving an unresolved/unauthorized URL at render time.
  let directorSignatureBytes = null;
  if (director_signature_url) {
    try {
      directorSignatureBytes = await fetchAsArrayBuffer(director_signature_url);
    } catch {
      directorSignatureBytes = null;
    }
  }

  // Prepare data map for placeholders
  const data = {
    inspectors: safeText(inspectors) || '—',
    date_of_complaint: humanDateFromYmd(date_of_complaint),
    date_of_inspection: humanDateFromYmd(date_of_inspection),
    date_of_issuance: humanDateFromYmd(date_of_issuance),
    business_name: safeText(business_name) || '—',
    business_address: safeText(business_address) || '—',
    complaint_details: safeText(complaint_details) || '—',
    // Image placeholder (if template includes {{director_signature}})
    // Image module expects either bytes or a resolvable value.
    director_signature: directorSignatureBytes,
  };

  doc.setData(data);
  try {
    doc.render();
  } catch (e) {
    const details = {
      error: e,
      message: e?.message,
      properties: e?.properties,
    };
    console.error('Docx render failed', details);
    throw new Error('Failed to render mission order DOCX. Check template placeholders.');
  }

  if (mission_order_qr_mode === 'generated') {
    adjustQrDrawingPlacement(doc.getZip());
  }

  const out = doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  return out;
}
