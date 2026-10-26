export function table(rows: Record<string, unknown>[], maxWidth: Record<string, number> = {}): string {
  if (!rows.length) return '(vide)';
  const cols = Object.keys(rows[0]);
  const cell = (row: Record<string, unknown>, col: string) => {
    const text = row[col] == null ? '' : String(row[col]);
    const max = maxWidth[col];
    return max && text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r, c).length)));
  const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cols), line(widths.map((w) => '─'.repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r, c))))].join('\n');
}
