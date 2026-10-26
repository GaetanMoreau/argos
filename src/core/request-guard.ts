const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const hostname = (hostHeader: string) => hostHeader.replace(/:\d+$/, '').toLowerCase();

/**
 * L'interface n'a pas de compte : elle n'est sûre que tant qu'elle reste propre au Mac.
 * - Host local exigé : bloque le « DNS rebinding » (un domaine piégé qui pointe vers 127.0.0.1).
 * - Requêtes qui modifient : Origin identique s'il est présent, et corps JSON obligatoire. Un site tiers ne peut
 *   envoyer du JSON qu'après une pré-vérification CORS, que le serveur ne valide jamais (CSRF).
 */
export function rejectRequest(req: { method: string; host?: string; origin?: string; contentType?: string }): string | null {
  if (!req.host || !LOCAL_HOSTS.has(hostname(req.host))) return 'Hôte non autorisé';
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null;
  if (req.origin) {
    let origin: URL;
    try {
      origin = new URL(req.origin);
    } catch {
      return 'Origine invalide';
    }
    if (origin.host !== req.host) return 'Origine non autorisée';
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.contentType?.toLowerCase().startsWith('application/json')) {
    return 'Corps JSON attendu';
  }
  return null;
}

/** Garde un lien externe seulement s'il est en http(s) : une source compromise ne doit pas injecter `javascript:`. */
export function httpUrlOrNull(url: unknown): string | null {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}
