import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch asset: ${url}`);
  return await res.arrayBuffer();
}

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

export async function generateMissionOrderDocx(data) {
  const inspectors = safeText(data.inspectors) || '—';
  const businessName = safeText(data.business_name) || '—';
  const businessAddress = safeText(data.business_address) || '—';
  const complaintDetails = safeText(data.complaint_details) || '—';
  const dateOfInspection = humanDateFromYmd(data.date_of_inspection);
  const dateOfIssuance = humanDateFromYmd(data.date_of_issuance);

  const docChildren = [];

  // Title
  docChildren.push(
    new Paragraph({
      text: 'MISSION ORDER',
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 250 },
    })
  );

  // Core lines
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'TO: ', bold: true }),
        new TextRun({ text: `FIELD INSPECTOR ${inspectors}` }),
      ],
      spacing: { after: 160 },
    })
  );

  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'SUBJECT: ', bold: true }),
        new TextRun({
          text: `TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS ${businessName} WITH ADDRESS AT ${businessAddress}`,
        }),
      ],
      spacing: { after: 160 },
    })
  );

  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'COMPLAINT DETAILS: ', bold: true }),
        new TextRun({ text: complaintDetails }),
      ],
      spacing: { after: 200 },
    })
  );

  // Dates table
  docChildren.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ children: [new TextRun({ text: 'DATE OF INSPECTION:', bold: true })] }),
              ],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ text: dateOfInspection })],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ children: [new TextRun({ text: 'DATE OF ISSUANCE:', bold: true })] }),
              ],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ text: dateOfIssuance })],
            }),
          ],
        }),
      ],
    })
  );

  docChildren.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // Body (kept concise; matches preview intent)
  docChildren.push(
    new Paragraph({
      text:
        'In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:',
      spacing: { after: 160 },
    })
  );

  const bullets = [
    'To verify the existence and authenticity of the Business Permits and other applicable permits, certificates, and other necessary documents, the completeness of the requirements therein.',
    'To check actual business operation of the subject establishment.',
    'To check compliance of said establishment with existing laws, ordinance, regulations relative to health & sanitation, fire safety, engineering & electrical installation standards.',
  ];

  bullets.forEach((t) => {
    docChildren.push(
      new Paragraph({
        text: t,
        bullet: { level: 0 },
        spacing: { after: 80 },
      })
    );
  });

  docChildren.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // Signature section
  docChildren.push(
    new Paragraph({
      children: [new TextRun({ text: 'Director E-Signature', bold: true })],
      spacing: { after: 120 },
    })
  );

  if (data.director_signature_url) {
    const bytes = await fetchAsArrayBuffer(data.director_signature_url);
    docChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: bytes,
            transformation: { width: 220, height: 90 },
          }),
        ],
        spacing: { after: 200 },
      })
    );
  } else {
    docChildren.push(
      new Paragraph({
        text: '—',
        spacing: { after: 200 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob;
}

export function buildMissionOrderDocxFileName({ business_name, mission_order_id }) {
  const base = safeText(business_name) || 'Mission-Order';
  const safe = base
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  const suffix = safeText(mission_order_id) ? `-${safeText(mission_order_id).slice(0, 8)}` : '';
  return `MISSION-ORDER${suffix}-${safe}.docx`;
}
