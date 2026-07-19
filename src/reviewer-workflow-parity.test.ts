import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The dogfood reviewer (.github/workflows/waiver-stamp-review.yml, a local `uses: ./…` action)
// and the reusable reviewer (.github/workflows/reusable-review.yml, the pinned external action
// adopters call) deliberately do NOT share a file: the dogfood can't route through the reusable
// workflow, because a reusable workflow must pin the action fully-qualified and the dogfood's
// self-referential @vX tag doesn't exist until release. That divergence is the risk this test
// guards — the pwn-request-critical shape (checkout the default branch, fetch the head only as
// data, permissions, concurrency) must stay identical in both, and only sanctioned points may
// differ (the trigger, the reusable-only App-token minting, and the local-vs-pinned action ref).

type Step = { uses?: string; name?: string; with?: Record<string, unknown> };
type Workflow = {
  permissions: Record<string, string>;
  jobs: { review: { 'runs-on': string; concurrency: unknown; steps: Step[] } };
};

const load = (path: string): Workflow => parse(readFileSync(path, 'utf8'));
const dogfood = load('.github/workflows/waiver-stamp-review.yml');
const reusable = load('.github/workflows/reusable-review.yml');

const stepsOf = (wf: Workflow) => wf.jobs.review.steps;
const checkout = (wf: Workflow) => stepsOf(wf).find((s) => s.uses?.startsWith('actions/checkout'));
const fetchHead = (wf: Workflow) =>
  stepsOf(wf).find((s) => s.name?.startsWith('Fetch the PR head'));
const actionStep = (wf: Workflow) =>
  stepsOf(wf).find(
    (s) => s.uses?.includes('waiver-stamp-review') && !s.uses.startsWith('actions/'),
  );

describe('reviewer workflow parity — dogfood vs reusable', () => {
  it('grants the same privileged permissions', () => {
    expect(reusable.permissions).toEqual(dogfood.permissions);
    expect(dogfood.permissions['pull-requests']).toBe('write');
  });

  it('shares runs-on and the branch-scoped, non-cancelling concurrency guard', () => {
    expect(reusable.jobs.review['runs-on']).toEqual(dogfood.jobs.review['runs-on']);
    expect(reusable.jobs.review.concurrency).toEqual(dogfood.jobs.review.concurrency);
  });

  it('checks out the default branch identically (never the PR head)', () => {
    expect(checkout(reusable)).toEqual(checkout(dogfood));
    expect(checkout(dogfood)?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(checkout(dogfood)?.with?.['persist-credentials']).toBe(false);
  });

  it('brings the PR head in only as git data, identically', () => {
    expect(fetchHead(reusable)).toEqual(fetchHead(dogfood));
    expect(fetchHead(dogfood)).toBeDefined();
  });

  it('runs the local action in the dogfood but pins it fully-qualified in the reusable', () => {
    // The load-bearing security decision: a `./` here in the reusable workflow would resolve
    // against the adopter's repo, reopening the pwn-request hole. It must be a pinned @vX ref.
    expect(actionStep(dogfood)?.uses).toBe('./.github/actions/waiver-stamp-review');
    expect(actionStep(reusable)?.uses).toMatch(
      /^jsalvata\/waiver-stamp\/\.github\/actions\/waiver-stamp-review@v\d+\.\d+\.\d+$/,
    );
  });

  it('adds no step to either reviewer beyond the sanctioned set', () => {
    // Dogfood: checkout, fetch-head, action. Reusable: the same plus the App-token mint.
    expect(stepsOf(dogfood)).toHaveLength(3);
    expect(stepsOf(reusable)).toHaveLength(4);
    expect(stepsOf(dogfood).some((s) => s.uses?.includes('create-github-app-token'))).toBe(false);
    expect(stepsOf(reusable).some((s) => s.uses?.includes('create-github-app-token'))).toBe(true);
  });
});
