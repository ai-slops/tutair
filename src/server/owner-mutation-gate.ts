import { ApiError } from "./types.js";

export class OwnerMutationGate {
  private readonly generations = new Map<string, number>();
  private readonly tails = new Map<string, Promise<void>>();

  current(owner: string): number {
    return this.generations.get(owner) ?? 0;
  }

  invalidate(owner: string): void {
    this.generations.set(owner, this.current(owner) + 1);
  }

  assertCurrent(owner: string, generation: number): void {
    if (this.current(owner) !== generation)
      throw new ApiError(409, "oauth_session_invalidated", "ChatGPT connection was disconnected");
  }

  async run(owner: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(owner) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(owner, tail);
    try {
      await current;
    } finally {
      if (this.tails.get(owner) === tail) this.tails.delete(owner);
    }
  }
}
