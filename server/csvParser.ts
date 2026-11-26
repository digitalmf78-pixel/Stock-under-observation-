export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCsvRecords(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') {
    headerIdx++;
  }
  if (headerIdx >= lines.length) return [];

  const headers = parseCsvLine(lines[headerIdx].replace(/^\uFEFF/, ''));
  const rows: Array<Record<string, string>> = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? '';
    }
    rows.push(record);
  }
  return rows;
}

export function toNum(val: string | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'nan' || trimmed.toLowerCase() === 'none') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBhavDateToIso(raw: string): string {
  // Converts "31-Aug-2026" or "13-Nov-2026" or "2026-11-13" to "YYYY-MM-DD"
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return trimmed;
  const months: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const m = months[match[2].toLowerCase()] ?? '01';
  const d = match[1].padStart(2, '0');
  return `${match[3]}-${m}-${d}`;
}
