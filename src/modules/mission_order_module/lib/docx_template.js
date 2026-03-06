import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';

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

export function buildMissionOrderDocxFileName({ business_name, mission_order_id }) {
  const base = safeText(business_name) || 'Mission-Order';
  const safe = base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  const suffix = safeText(mission_order_id) ? `-${safeText(mission_order_id).slice(0, 8)}` : '';
  return `MISSION-ORDER${suffix}-${safe}.docx`;
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
}) {
  // Fetch and load template
  const templateBuf = await fetchAsArrayBuffer(templateUrl);
  const zip = new PizZip(templateBuf);

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
    // eslint-disable-next-line no-console
    console.error('Docx render failed', details);
    throw new Error('Failed to render mission order DOCX. Check template placeholders.');
  }

  const out = doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  return out;
}
