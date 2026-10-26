export function useScan() {
  const running = useState('scan-running', () => false);
  const message = useState<string | null>('scan-message', () => null);

  async function run(siteId?: number) {
    if (running.value) return;
    running.value = true;
    message.value = null;
    try {
      const results = await $fetch('/api/scan', { method: 'POST', body: { siteId } });
      const opened = results.reduce((n, r) => n + r.opened, 0);
      const errors = results.filter((r) => r.error).length;
      const parts = [opened ? plural(opened, 'nouveauté', 'nouveautés') : 'Rien de nouveau'];
      if (errors) parts.push(plural(errors, 'site en erreur', 'sites en erreur'));
      message.value = parts.join(' · ');
      await refreshNuxtData();
    } catch (err: any) {
      message.value = err?.data?.statusMessage ?? 'Le scan a échoué';
    } finally {
      running.value = false;
    }
  }

  return { running, message, run };
}
