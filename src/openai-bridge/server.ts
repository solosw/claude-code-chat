import * as http from 'http';
import { loadBridgeConfig } from './config';

const CONFIG = loadBridgeConfig();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, message: string, type = 'api_error'): void {
  sendJson(res, status, {
    type: 'error',
    error: {
      type,
      message,
    },
  });
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': '*',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          config: CONFIG.configPath,
          listen: `http://${CONFIG.listenHost}:${CONFIG.port}`,
          upstream: `${CONFIG.upstreamBaseUrl}/chat/completions`,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: CONFIG.models.map((id) => ({ id, object: 'model', owned_by: 'openai-bridge' })),
        });
        return;
      }

      sendError(res, 404, `No route for ${req.method} ${url.pathname}`, 'not_found_error');
    } catch (error: any) {
      sendError(res, 500, error?.message || String(error), 'proxy_error');
    }
  });
}

export function startServer(): http.Server {
  const server = createServer();
  server.listen(CONFIG.port, CONFIG.listenHost, () => {
    console.log(`OpenAI bridge listening on http://${CONFIG.listenHost}:${CONFIG.port}`);
    console.log(`Config: ${CONFIG.configPath}`);
    console.log(`Upstream: ${CONFIG.upstreamBaseUrl}/chat/completions`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}
