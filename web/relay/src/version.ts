import { readFileSync } from 'node:fs';

/**
 * The relay's own version, as `ping` answers it. Read from package.json at
 * startup rather than duplicated in a constant, so the two can never drift;
 * the file sits next to `dist/` however the package is laid out, which is why
 * the path goes through `import.meta.url` instead of the working directory.
 */
export const VERSION: string = versionOfPackage();

function versionOfPackage(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url));
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !parsed.version) {
    // A deployment that lost its package.json would answer a silent lie; fail loudly instead.
    throw new Error('web/relay/package.json has no version; ping cannot answer');
  }
  return parsed.version;
}
