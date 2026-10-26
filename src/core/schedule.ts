import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { dataDir, dbPath, root } from './db/index.ts';
import { exec } from './macos.ts';

const LABEL = 'com.argos.scan';

export const plistPath = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
export const logPath = join(dataDir, 'logs/scan.log');
const domain = `gui/${userInfo().uid}`;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Agent launchd : `argos scan --notify` chaque jour à l'heure donnée (rattrapé au réveil si le Mac dormait). */
export function buildPlist(hour: number, minute: number): string {
  const args = [process.execPath, join(root, 'src/cli/index.ts'), 'scan', '--notify'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ARGOS_DB</key>
    <string>${xml(dbPath)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export async function install(hour: number, minute: number) {
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  mkdirSync(join(homedir(), 'Library/LaunchAgents'), { recursive: true });
  if (existsSync(plistPath)) await exec('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
  writeFileSync(plistPath, buildPlist(hour, minute));
  await exec('launchctl', ['bootstrap', domain, plistPath]);
}

export async function uninstall(): Promise<boolean> {
  if (!existsSync(plistPath)) return false;
  await exec('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
  rmSync(plistPath);
  return true;
}

export async function isLoaded(): Promise<boolean> {
  return exec('launchctl', ['print', `${domain}/${LABEL}`]).then(
    () => true,
    () => false,
  );
}
