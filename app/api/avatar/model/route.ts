import { readFile } from "node:fs/promises";
import { join } from "node:path";

const VRM_PATH = join(process.cwd(), "public", "models", "default.vrm");

export async function GET() {
  try {
    const data = await readFile(VRM_PATH);
    return new Response(data, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Model not found", { status: 404 });
  }
}
