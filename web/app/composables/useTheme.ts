type Theme = 'light' | 'dark';

const KEY = 'argos-theme';

/**
 * Thème clair ou sombre. Sans choix enregistré, l'interface démarre comme macOS ;
 * dès le premier clic, le choix est mémorisé dans le navigateur.
 */
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light');

  onMounted(() => {
    const saved = document.documentElement.dataset.theme;
    theme.value =
      saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  function toggle() {
    const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
    theme.value = next;
    const root = document.documentElement;
    // Bascule d'un bloc : sans cela, les éléments avec transition changent de couleur après le fond.
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Stockage indisponible : le choix vaut pour la session en cours.
    }
  }

  return { theme, toggle };
}
