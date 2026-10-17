import type { StdioOptions } from "node:child_process";

export type BootstrapOptions = {
  readonly root?: string;
  readonly execPath?: string;
  readonly npmCli?: string;
  readonly stdio?: StdioOptions;
};

export class BootstrapCommandError extends Error {
  readonly status: number;
}

export function isSupportedNode(version: string): boolean;
export function ensureLockedDependencies(options?: BootstrapOptions): void;
export function runNpm(args: readonly string[], options?: BootstrapOptions): void;
