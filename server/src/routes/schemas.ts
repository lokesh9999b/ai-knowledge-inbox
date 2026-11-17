import { z } from 'zod';

export const MAX_NOTE_CHARS = 20_000;

const title = z.string().trim().max(200).optional();

export const ingestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('note'),
    content: z.string().trim().min(1, 'must not be empty').max(MAX_NOTE_CHARS, `must be at most ${MAX_NOTE_CHARS} characters`),
    title,
  }),
  z.object({
    type: z.literal('url'),
    url: z.string().trim().min(1, 'must not be empty').max(2048),
    title,
  }),
]);

export const querySchema = z.object({
  question: z.string().trim().min(3, 'must be at least 3 characters').max(1000, 'must be at most 1000 characters'),
  topK: z.number().int().min(1).max(10).default(5),
});

export type IngestBody = z.infer<typeof ingestSchema>;
export type QueryBody = z.infer<typeof querySchema>;
