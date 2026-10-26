import { exec } from './macos.ts';

const SERVICE = 'argos';

/** Secret du trousseau macOS (session de l'utilisateur), ou `null` s'il n'existe pas. */
export async function readSecret(account: string): Promise<string | null> {
  try {
    const { stdout } = await exec('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Crée ou remplace (-U) le secret dans le trousseau. */
export async function writeSecret(account: string, value: string) {
  await exec('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value]);
}
