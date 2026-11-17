import * as cheerio from 'cheerio';
import { AppError } from '../errors.js';
import { assertPublicUrl, parsePublicUrl } from './urlSafety.js';

export interface FetchedPage {
  title: string;
  text: string;
}

export interface UrlFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

export class HttpUrlFetcher implements UrlFetcher {
  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    const { body, contentType, finalUrl } = await this.get(rawUrl);
    if (/text\/plain/i.test(contentType)) {
      return { title: finalUrl.hostname, text: body.trim() };
    }
    if (!/html|xml/i.test(contentType)) {
      throw new AppError('UNPROCESSABLE', `Unsupported content type "${contentType || 'unknown'}"; only HTML and text are supported`);
    }
    return extractReadableText(body, finalUrl.hostname);
  }

  /** GET with manual redirects so every hop is re-checked against the SSRF guard. */
  private async get(rawUrl: string) {
    let url = parsePublicUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(url);
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'user-agent': 'AIKnowledgeInbox/1.0', accept: 'text/html,text/plain;q=0.9' },
        });
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        throw new AppError('UPSTREAM_ERROR', timedOut ? 'Fetching the URL timed out' : `Could not fetch the URL: ${(err as Error).message}`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
        url = parsePublicUrl(new URL(res.headers.get('location')!, url).toString());
        continue;
      }
      if (!res.ok) throw new AppError('UPSTREAM_ERROR', `The URL responded with HTTP ${res.status}`);
      const body = await readCapped(res);
      return { body, contentType: res.headers.get('content-type') ?? '', finalUrl: url };
    }
    throw new AppError('UNPROCESSABLE', `Too many redirects (max ${MAX_REDIRECTS})`);
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new AppError('PAYLOAD_TOO_LARGE', `Page exceeds the ${MAX_BYTES / 1024 / 1024}MB limit`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** Strips boilerplate (scripts, nav, footers...) and returns the page title plus visible text. */
export function extractReadableText(html: string, fallbackTitle: string): FetchedPage {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg, iframe, nav, footer, header, aside, form').remove();
  const title = ($('title').first().text() || $('h1').first().text() || fallbackTitle).replace(/\s+/g, ' ').trim();
  const root = $('main, article').first().length ? $('main, article').first() : $('body');
  const blocks: string[] = [];
  root.find('h1, h2, h3, h4, p, li, pre, blockquote, td').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) blocks.push(text);
  });
  const text = (blocks.length ? blocks.join('\n\n') : root.text().replace(/\s+/g, ' ')).trim();
  return { title: title.slice(0, 200), text };
}
