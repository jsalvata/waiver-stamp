import { z } from 'zod/v4';

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const PerCommit = z.object({
  sha,
  subject: z.string(),
  class: z.enum(['stamped', 'invalid', 'unwaivered', 'skipped']),
  reasons: z.array(z.string()),
  perOpFindings: z.array(
    z.object({ op: z.string(), ok: z.boolean(), reason: z.string().optional() }),
  ),
  uncoveredFiles: z.array(z.string()),
});

export const ArtifactReportSchema = z.object({
  verdict: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES', 'ABSTAIN']),
  base: sha,
  head: sha,
  toolVersion: z.string(),
  commits: z.array(PerCommit),
});

export type ArtifactReport = z.infer<typeof ArtifactReportSchema>;

/** Parse + validate the untrusted artifact JSON; throws on any deviation (fail-closed). */
export function parseArtifact(json: string): ArtifactReport {
  return ArtifactReportSchema.parse(JSON.parse(json));
}
