import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_SCHEMA =
  'https://raw.githubusercontent.com/jsalvata/waiver-stamp/main/schema/waiver-stamp-config.v0.schema.json';

/**
 * Drop the closed-by-default `.waiver-stamp.json` only when none exists (§4.11). Every gate ships
 * closed: `allowBumping` empty, and `changeDocs.allow` empty so it confines nothing. But `changeDocs.deny`
 * is pre-populated with the AI-instruction assets (CLAUDE.md, AGENTS.md, GEMINI.md, SKILL.md,
 * `.claude/**`, `.cursor/**`, `.cursorrules`, `.github/copilot-instructions.md`) — a guard that already
 * stands the moment the adopter opens `allow`, so a malicious edit can't ride in as a "doc". A detected
 * lockfile-honesty check is recorded here (§4.8), the one place we may add it. An existing file is never
 * touched — widening someone's policy is exactly what setup must not do; it's surfaced on the hand-off
 * page instead.
 */
export async function seedConfigIfAbsent(
  cwd: string,
  { lockfileHonestyCheck }: { lockfileHonestyCheck?: string },
): Promise<{ seeded: boolean; existing: boolean }> {
  const path = join(cwd, '.waiver-stamp.json');
  const present = await access(path).then(
    () => true,
    () => false,
  );
  if (present) return { seeded: false, existing: true };

  const config: Record<string, unknown> = {
    $schema: CONFIG_SCHEMA,
    allowBumping: [],
    changeDocs: {
      allow: [],
      deny: [
        '.claude/**',
        '**/CLAUDE.md',
        '**/AGENTS.md',
        '**/GEMINI.md',
        '**/SKILL.md',
        '.cursor/**',
        '.cursorrules',
        '.github/copilot-instructions.md',
      ],
    },
  };
  if (lockfileHonestyCheck) config.lockfileHonestyCheck = lockfileHonestyCheck;
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return { seeded: true, existing: false };
}
