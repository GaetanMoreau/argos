/** `6.4.3-beta` → [6, 4, 3] ; les suffixes sont ignorés. */
const segments = (v: string) => (v.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);

/** Compare des versions numériques à N segments (`6.4.3.1`, `5.3`). */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [segments(a), segments(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

type Lag = 'major' | 'minor' | 'patch';

/** Retard d'une version sur la dernière publiée ; `null` si elle est à jour (ou plus récente). */
export function updateLag(version: string, latest: string | null | undefined): Lag | null {
  if (!latest || compareVersions(latest, version) <= 0) return null;
  const [a, b] = [segments(version), segments(latest)];
  if ((b[0] ?? 0) !== (a[0] ?? 0)) return 'major';
  if ((b[1] ?? 0) !== (a[1] ?? 0)) return 'minor';
  return 'patch';
}
