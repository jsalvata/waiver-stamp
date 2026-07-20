import { spawn } from 'node:child_process';

export interface OpenBrowserDeps {
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  print?: (msg: string) => void;
}

/**
 * Open `url` in the user's browser via the platform opener (`open` on macOS, `xdg-open` elsewhere).
 * If spawning fails (opener missing, headless), print the URL so the user can open it themselves —
 * the flow still completes once they visit it. Deps are injectable for tests.
 */
export function openBrowser(url: string, deps: OpenBrowserDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const spawnProcess = deps.spawnProcess ?? spawn;
  const print = deps.print ?? ((m: string) => console.log(m));
  const opener = platform === 'darwin' ? 'open' : 'xdg-open';

  return new Promise((resolve) => {
    const fallback = (): void => {
      print(`Open this URL in your browser:\n  ${url}`);
      resolve();
    };
    try {
      const child = spawnProcess(opener, [url], { stdio: 'ignore' });
      child.on('error', fallback);
      child.on('spawn', resolve);
    } catch {
      fallback();
    }
  });
}
