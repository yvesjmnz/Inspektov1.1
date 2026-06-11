export function getBusinessDisplayName(row) {
  const marketedName = String(row?.marketed_name || row?.business?.marketed_name || '').trim();
  if (marketedName) return marketedName;
  return String(row?.business_name || row?.business?.business_name || '').trim();
}

export function getBusinessLegalName(row) {
  return String(row?.business_name || row?.business?.business_name || '').trim();
}

export function getBusinessSecondaryName(row) {
  const displayName = getBusinessDisplayName(row);
  const legalName = getBusinessLegalName(row);
  if (!displayName || !legalName) return '';
  return displayName.toLowerCase() === legalName.toLowerCase() ? '' : legalName;
}

export async function enrichRowsWithBusinessDisplayNames(supabase, rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const businessPks = Array.from(
    new Set(sourceRows.map((row) => row?.business_pk).filter((value) => value !== null && value !== undefined))
  );

  if (businessPks.length === 0) return sourceRows;

  const { data, error } = await supabase
    .from('businesses')
    .select('business_pk, business_name, marketed_name')
    .in('business_pk', businessPks);

  if (error) throw error;

  const businessByPk = new Map((data || []).map((business) => [business.business_pk, business]));
  return sourceRows.map((row) => {
    const business = businessByPk.get(row?.business_pk);
    if (!business?.marketed_name) return row;
    return {
      ...row,
      legal_business_name: row.business_name,
      marketed_name: business.marketed_name,
      business_name: business.marketed_name,
    };
  });
}
