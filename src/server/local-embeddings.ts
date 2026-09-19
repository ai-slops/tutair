import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const model = "Xenova/all-MiniLM-L6-v2";
const revision = "751bff37182d3f1213fa05d7196b954e230abad9";
export const localEmbeddingProfile = `${model}@${revision}:q8:mean:l2:384:chars8000:v1`;
const vectorsSchema = z.array(z.array(z.number().finite()).length(384));

async function loadModel() {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", model, {
    revision,
    dtype: "q8",
    device: "cpu",
    cache_dir: process.env["TUTOR_MODEL_CACHE"] ?? join(homedir(), ".cache", "tutair", "models"),
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
}

let modelPromise: ReturnType<typeof loadModel> | undefined;

export async function embedLocal(texts: readonly string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  modelPromise ??= loadModel();
  const extractor = await modelPromise;
  const output = await extractor(
    texts.map((text) => text.slice(0, 8000)),
    { pooling: "mean", normalize: true },
  );
  return vectorsSchema.parse(output.tolist());
}
