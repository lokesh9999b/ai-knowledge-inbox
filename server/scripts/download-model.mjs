// Downloads the embedding model into a cache directory so it can be baked into the Docker image.
// Usage: node scripts/download-model.mjs <cacheDir>
import { env, pipeline } from '@huggingface/transformers';

const cacheDir = process.argv[2];
if (!cacheDir) {
  console.error('usage: node scripts/download-model.mjs <cacheDir>');
  process.exit(1);
}
env.cacheDir = cacheDir;

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const out = await extractor(['warm up'], { pooling: 'mean', normalize: true });
console.log(`model cached in ${cacheDir} (embedding dim ${out.dims[1]})`);
process.exit(0);
