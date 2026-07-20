import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { openBrowser } from './open-browser.ts';

describe('openBrowser', () => {
  it('spawns `open` on darwin with the url', async () => {
    const child = new EventEmitter() as EventEmitter & { on: unknown };
    const spawnProcess = vi.fn(() => child) as never;
    const promise = openBrowser('http://127.0.0.1:1/', { platform: 'darwin', spawnProcess });
    (child as EventEmitter).emit('spawn');
    await promise;
    expect(spawnProcess).toHaveBeenCalledWith('open', ['http://127.0.0.1:1/'], { stdio: 'ignore' });
  });

  it('prints the url when spawning fails', async () => {
    const child = new EventEmitter();
    const spawnProcess = vi.fn(() => child) as never;
    const print = vi.fn();
    const promise = openBrowser('http://127.0.0.1:1/', {
      platform: 'linux',
      spawnProcess,
      print,
    });
    child.emit('error', new Error('ENOENT'));
    await promise;
    expect(spawnProcess).toHaveBeenCalledWith('xdg-open', ['http://127.0.0.1:1/'], {
      stdio: 'ignore',
    });
    expect(print).toHaveBeenCalledWith(expect.stringContaining('http://127.0.0.1:1/'));
  });
});
