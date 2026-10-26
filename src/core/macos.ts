import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const exec = promisify(execFile);

/** Littéral de chaîne AppleScript (guillemets et antislashs échappés). */
export const appleScriptString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
