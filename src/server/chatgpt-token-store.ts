import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./types.js";

const GrantSchema = z.object({
  clientId: z.string().min(1),
  issuer: z.url(),
  subject: z.string().min(1),
  scopes: z.array(z.string()),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  selectedModel: z.string().min(1).nullable(),
});
export type StoredGrant = z.infer<typeof GrantSchema>;

const StoreSchema = z.object({
  version: z.literal(1),
  hostId: z.uuid(),
  grants: z.record(z.string(), GrantSchema),
});
type StoreData = z.infer<typeof StoreSchema>;

const mutationTails = new Map<string, Promise<void>>();

export class ProtectedTokenStore {
  constructor(readonly path: string) {}

  async hostId(): Promise<string> {
    return this.mutate(async () => {
      const existing = await this.load();
      if (existing !== null) return existing.hostId;
      const created = this.empty();
      await this.save(created);
      return created.hostId;
    });
  }

  async read(owner: string): Promise<StoredGrant | null> {
    const grant = (await this.load())?.grants[owner];
    return grant ?? null;
  }

  async write(owner: string, grant: StoredGrant): Promise<void> {
    await this.mutate(async () => {
      const data = (await this.load()) ?? this.empty();
      await this.save({ ...data, grants: { ...data.grants, [owner]: GrantSchema.parse(grant) } });
    });
  }

  async delete(owner: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.load();
      if (data === null || data.grants[owner] === undefined) return;
      const grants = Object.fromEntries(
        Object.entries(data.grants).filter(([learnerId]) => learnerId !== owner),
      );
      await this.save({ ...data, grants });
    });
  }

  async selectModel(owner: string, model: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.load();
      const grant = data?.grants[owner];
      if (data === null || grant === undefined)
        throw new ApiError(401, "chatgpt_not_connected", "Connect ChatGPT for this learner first");
      await this.save({
        ...data,
        grants: { ...data.grants, [owner]: { ...grant, selectedModel: model } },
      });
    });
  }

  private async load(): Promise<StoreData | null> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private empty(): StoreData {
    return { version: 1, hostId: crypto.randomUUID(), grants: {} };
  }

  private async mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    const key = resolve(this.path);
    const previous = mutationTails.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    mutationTails.set(key, tail);
    try {
      return await current;
    } finally {
      if (mutationTails.get(key) === tail) mutationTails.delete(key);
    }
  }

  private async save(data: StoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(data), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
