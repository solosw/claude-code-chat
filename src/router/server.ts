import * as http from 'http';
import { formatAnthropicToOpenAI } from './formatRequest';
import { streamOpenAIToAnthropic } from './streamResponse';
import { formatOpenAIToAnthropic } from './formatResponse';

const DEFAULT_PORT = 31548;
const DEFAULT_BASE_URL = "http://localhost:8787/v1";

let server: http.Server | null = null;
let currentPort: number = DEFAULT_PORT;
let baseUrl: string = DEFAULT_BASE_URL;

export function setBaseUrl(url: string): void {
  baseUrl = url || DEFAULT_BASE_URL;
  console.log('[Router] Base URL set to:', baseUrl);
}

// Helper to parse JSON body
async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Prevent payload too large (50MB limit)
      if (body.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method || 'GET';

    try {
      // POST /v1/messages
      if (url.pathname === '/v1/messages' && method === 'POST') {
        console.log('[Router] 📥 Received request to /v1/messages');

        const abortController = new AbortController();
        let downstreamClosed = false;
        let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        let cleanupStarted = false;

        const closeDownstream = async (reason?: string) => {
          if (cleanupStarted) {
            return;
          }
          cleanupStarted = true;
          downstreamClosed = true;
          try {
            abortController.abort(reason);
          } catch {
            // Ignore abort errors
          }
          try {
            await streamReader?.cancel(reason);
          } catch {
            // Ignore reader cancellation errors
          }
        };

        req.on('aborted', () => {
          void closeDownstream('Request aborted');
        });
        res.on('close', () => {
          void closeDownstream('Response closed');
        });

        const anthropicRequest = await parseBody(req);
        const openaiRequest = formatAnthropicToOpenAI(anthropicRequest);

        console.log('[Router] 🔄 Converted to OpenAI format:', {
          model: openaiRequest.model,
          stream: openaiRequest.stream,
          messageCount: openaiRequest.messages?.length
        });

        const bearerToken = (req.headers['x-api-key'] as string) ||
          (req.headers.authorization as string)?.replace("Bearer ", "").replace("bearer ", "");

        if (!bearerToken || bearerToken.trim() === '') {
          console.log('[Router] ❌ No bearer token found');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'No API key provided. Please configure your OpenCredits user key in environment variables.'
            }
          }));
          return;
        }

        const fetchHeaders = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${bearerToken}`,
          "HTTP-Referer": "https://claude-code-chat.local",
          "X-Title": "Claude-Code-Chat-Router"
        };

        const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: fetchHeaders,
          body: JSON.stringify(openaiRequest),
          signal: abortController.signal,
        });

        console.log('[Router] 📥 Response status:', openaiResponse.status);

        if (!openaiResponse.ok) {
          const errorText = await openaiResponse.text();
          console.log('[Router] ❌ Error:', errorText);

          // Try to parse as JSON, otherwise use raw text
          let errorMessage = errorText;
          try {
            const parsed = JSON.parse(errorText);
            errorMessage = parsed.error?.message || parsed.message || errorText;
          } catch {}

          res.writeHead(openaiResponse.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: {
              type: openaiResponse.status === 401 ? 'authentication_error' : 'api_error',
              message: `[Router] ${errorMessage}`
            }
          }));
          return;
        }

        if (openaiRequest.stream) {
          console.log('[Router] 🌊 Starting stream response');
          const anthropicStream = streamOpenAIToAnthropic(
            openaiResponse.body as ReadableStream,
            openaiRequest.model
          );

          if (downstreamClosed) {
            await closeDownstream('Downstream already closed before stream start');
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          streamReader = anthropicStream.getReader();

          const pump = async () => {
            try {
              while (true) {
                if (downstreamClosed || res.writableEnded || res.destroyed) {
                  await closeDownstream('Downstream closed during stream');
                  return;
                }
                const activeReader = streamReader;
                if (!activeReader) {
                  return;
                }
                const { done, value } = await activeReader.read();
                if (done) {
                  if (!res.writableEnded && !res.destroyed) {
                    res.end();
                  }
                  break;
                }
                if (downstreamClosed || res.writableEnded || res.destroyed) {
                  await closeDownstream('Downstream closed before write');
                  return;
                }
                res.write(value);
              }
            } catch (error: any) {
              if (downstreamClosed || error?.name === 'AbortError') {
                return;
              }
              console.error('[Router] Stream error:', error);
              if (!res.writableEnded && !res.destroyed) {
                res.end();
              }
            }
          };

          void pump();
        } else {
          if (downstreamClosed) {
            await closeDownstream('Downstream closed before non-stream response');
            return;
          }
          const openaiData = await openaiResponse.json();
          const anthropicResponse = formatOpenAIToAnthropic(openaiData, openaiRequest.model);
          if (!res.writableEnded && !res.destroyed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(anthropicResponse));
          }
        }
        return;
      }

      // 404 Not Found
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (error: any) {
      if (error?.name === 'AbortError' || res.writableEnded || res.destroyed) {
        return;
      }
      console.error('[Router] Error processing request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `[Router] Internal error: ${(error as Error).message}`
        }
      }));
    }
  });
}

export function startRouter(port: number = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log('[Router] Already running on port', currentPort);
      resolve(currentPort);
      return;
    }

    server = createServer();

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Router] Port ${port} in use, trying ${port + 1}`);
        server = null;
        startRouter(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      currentPort = port;
      console.log(`[Router] 🚀 Running on http://localhost:${port}`);
      resolve(port);
    });
  });
}

export function stopRouter(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log('[Router] Stopped');
      server = null;
      resolve();
    });
  });
}

export function isRouterRunning(): boolean {
  return server !== null;
}

export function getRouterPort(): number {
  return currentPort;
}
