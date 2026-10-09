import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

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

export class ProtectedTokenStore {
  constructor(readonly path: string) {}

  async hostId(): Promise<string> {
    const data = await this.load();
    await this.save(data);
    return data.hostId;
  }

  async read(owner: string): Promise<StoredGrant | null> {
    const grant = (await this.load()).grants[owner];
    return grant ?? null;
  }

  async write(owner: string, grant: StoredGrant): Promise<void> {
    const data = await this.load();
    await this.save({ ...data, grants: { ...data.grants, [owner]: GrantSchema.parse(grant) } });
  }

  async delete(owner: string): Promise<void> {
    const data = await this.load();
    const grants = Object.fromEntries(
      Object.entries(data.grants).filter(([learnerId]) => learnerId !== owner),
    );
    await this.save({ ...data, grants });
  }

  async selectModel(owner: string, model: string): Promise<void> {
    const data = await this.load();
    const grant = data.grants[owner];
    if (grant === undefined) return;
    await this.save({
      ...data,
      grants: { ...data.grants, [owner]: { ...grant, selectedModel: model } },
    });
  }

  private async load(): Promise<StoreData> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, hostId: crypto.randomUUID(), grants: {} };
      }
      throw error;
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
