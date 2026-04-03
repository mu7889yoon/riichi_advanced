import * as http from 'node:http';
import { handler } from '../lambda/health-check/index';

let server: http.Server;
let serverPort: number;

function startServer(responseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer(responseHandler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
      }
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

afterEach(async () => {
  await stopServer();
});

describe('health-check Lambda', () => {
  // Validates: Requirements 3.2
  test('returns healthy: true when server responds with HTTP 200', async () => {
    await startServer((_req, res) => {
      res.writeHead(200);
      res.end('OK');
    });

    const result = await handler({
      instanceIp: '127.0.0.1',
      port: serverPort,
      path: '/',
    });

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeUndefined();
  });

  // Validates: Requirements 3.3
  test('returns healthy: false for non-200 status codes', async () => {
    await startServer((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });

    const result = await handler({
      instanceIp: '127.0.0.1',
      port: serverPort,
      path: '/',
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  // Validates: Requirements 3.3
  test('returns healthy: false for 404 status code', async () => {
    await startServer((_req, res) => {
      res.writeHead(404);
      res.end('Not Found');
    });

    const result = await handler({
      instanceIp: '127.0.0.1',
      port: serverPort,
      path: '/health',
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  // Validates: Requirements 3.3
  test('returns healthy: false on connection error (connection refused)', async () => {
    // Use a port that nothing is listening on
    const result = await handler({
      instanceIp: '127.0.0.1',
      port: 1,
      path: '/',
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  // Validates: Requirements 3.4
  test('returns healthy: false on timeout', async () => {
    await startServer((_req, _res) => {
      // Never respond — triggers the 5s timeout
    });

    const result = await handler({
      instanceIp: '127.0.0.1',
      port: serverPort,
      path: '/',
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('timeout');
    expect(result.statusCode).toBeUndefined();
  }, 10_000); // extend Jest timeout for the 5s Lambda timeout
});
