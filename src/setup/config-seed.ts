import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_SCHEMA =
  'https://raw.githubusercontent.com/jsalvata/waiver-stamp/main/schema/waiver-stamp-config.v0.schema.json';

/**
 * Drop a closed-by-default `.waiver-stamp.json` only when none exists (§4.11). Policy is a security
 * judgment, so the seed opens nothing: empty `allowBumping` and empty `changeDocs` — a scaffold with
 * every gate closed, for the adopter to widen deliberately (an empty `changeDocs.allow` confines
 * nothing, so nothing is auto-exempted from review). A detected lockfile-honesty check is recorded
 * here (§4.8), the one place we may add it. An existing file is never touched — widening someone's
 * policy is exactly what setup must not do; it's surfaced on the hand-off page instead.
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
    changeDocs: { allow: [], deny: [] },
  };
  if (lockfileHonestyCheck) config.lockfileHonestyCheck = lockfileHonestyCheck;
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return { seeded: true, existing: false };
}
