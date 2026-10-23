import { runScan } from './scan.ts';
import type { Env } from '../core/types.ts';
import type { DeleteMode } from '../actions/delete.ts';

/**
 * TUI surucusu.
 *
 * Ink/React yalnizca burada yuklenir; CLI'nin diger komutlari
 * (scan --json gibi) tarayici kutuphanelerini hic yuklemez.
 */
export async function runTui(args: {
  envs: Env[];
  profile?: string;
  exclude: string[];
  mode: DeleteMode;
}): Promise<void> {
  const React = (await import('react')).default;
  const { render } = await import('ink');
  const { App } = await import('../ui/App.tsx');

  const instance = render(
    React.createElement(App, {
      mode: args.mode,
      onScan: async (
        onProgress: (done: number, total: number, bytes: number) => void,
      ) => {
        const opts = {
          envs: args.envs,
          profile: args.profile,
          minAgeDays: 0,
          json: true as const,
          includeBytes: true,
          exclude: args.exclude,
          quiet: true,
          onProgress,
        };
        return runScan(opts);
      },
    }),
  );

  await instance.waitUntilExit();
}