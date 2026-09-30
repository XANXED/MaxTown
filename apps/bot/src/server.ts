import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BotEnv, handleRequest } from './index.ts';

const DEFAULT_DIST_DIRECTORY = fileURLToPath(new URL('../../miniapp/dist/', import.meta.url));
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export type CreateNodeServerOptions = {
  env: BotEnv;
  distDirectory?: string;
  publicOrigin?: string;
  apiHandler?: typeof handleRequest;
};

function requestHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function requestBody(message: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (message.method === 'GET' || message.method === 'HEAD' || message.method === 'OPTIONS') return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of message) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const combined = Buffer.concat(chunks);
  const body = new Uint8Array(combined.byteLength);
  body.set(combined);
  return body.buffer;
}

function withinDirectory(root: string, candidate: string): boolean {
  const relative = candidate.slice(root.length);
  return candidate === root || (relative.startsWith(sep) && !relative.startsWith(`${sep}..${sep}`));
}

async function staticResponse(
  pathname: string,
  method: string,
  directory: string,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const root = resolve(directory);
  const requestedFile = resolve(root, `.${decodedPath}`);
  if (!withinDirectory(root, requestedFile)) return new Response('Not Found', { status: 404 });

  let filePath = requestedFile;
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('not_a_file');
  } catch {
    filePath = resolve(root, 'index.html');
  }

  if (!withinDirectory(root, filePath)) return new Response('Not Found', { status: 404 });
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers({
    'content-type': MIME_TYPES[extname(filePath).toLocaleLowerCase('en-US')] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  if (filePath.endsWith('index.html')) {
    headers.set('cache-control', 'no-cache');
  } else {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(method === 'HEAD' ? null : Uint8Array.from(contents), { status: 200, headers });
}

async function writeResponse(response: Response, target: ServerResponse): Promise<void> {
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.writeHead(response.status);
  if (response.body === null) {
    target.end();
    return;
  }
  target.end(Buffer.from(await response.arrayBuffer()));
}

export function createNodeServer(options: CreateNodeServerOptions): Server {
  const distDirectory = options.distDirectory ?? DEFAULT_DIST_DIRECTORY;
  const handleApi = options.apiHandler ?? handleRequest;

  return createHttpServer((incoming, outgoing) => {
    void (async () => {
      try {
        const method = incoming.method ?? 'GET';
        const requestPath = incoming.url ?? '/';
        const parsedUrl = new URL(requestPath, options.publicOrigin ?? `http://${incoming.headers.host ?? 'localhost'}`);
        const isApi = parsedUrl.pathname === '/api' || parsedUrl.pathname.startsWith('/api/');
        if (!isApi) {
          await writeResponse(await staticResponse(parsedUrl.pathname, method, distDirectory), outgoing);
          return;
        }

        const body = await requestBody(incoming);
        const request = new Request(parsedUrl, {
          method,
          headers: requestHeaders(incoming),
          ...(body === undefined ? {} : { body }),
        });
        await writeResponse(await handleApi(request, options.env), outgoing);
      } catch (error) {
        const status = error instanceof Error && error.message === 'request_body_too_large' ? 413 : 500;
        if (!outgoing.headersSent) outgoing.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
        outgoing.end(status === 413 ? 'Payload Too Large' : 'Internal Server Error');
      }
    })();
  });
}
