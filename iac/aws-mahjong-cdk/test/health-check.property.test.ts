import * as http from 'node:http';
import * as fc from 'fast-check';
import { handler } from '../lambda/health-check/index';

/**
 * Property 2: ヘルスチェックのステータスコード判定
 *
 * 任意のHTTPステータスコードに対して、200の場合のみhealthy: trueを返し、
 * それ以外はhealthy: falseを返すことを検証する。
 *
 * Validates: Requirements 3.2, 3.3
 */

let server: http.Server;
let serverPort: number;
let currentStatusCode: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer((_req, res) => {
      res.writeHead(currentStatusCode);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

describe('health-check Lambda - Property Tests', () => {
  /**
   * Property 2: ヘルスチェックのステータスコード判定
   *
   * For any HTTP status code (200-599), verify that only 200 returns
   * healthy: true, and all others return healthy: false.
   *
   * Note: 1xx informational status codes are excluded because Node.js
   * http module treats them as intermediate responses (not final),
   * causing the client to wait for the actual response and eventually timeout.
   * The handler still correctly returns healthy: false for these cases,
   * but they are tested separately to avoid the 5s timeout per iteration.
   *
   * Validates: Requirements 3.2, 3.3
   */
  test('Property 2: for any HTTP status code (200-599), only 200 returns healthy: true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 200, max: 599 }),
        async (statusCode) => {
          currentStatusCode = statusCode;

          const result = await handler({
            instanceIp: '127.0.0.1',
            port: serverPort,
            path: '/',
          });

          if (statusCode === 200) {
            expect(result.healthy).toBe(true);
          } else {
            expect(result.healthy).toBe(false);
          }
          expect(result.statusCode).toBe(statusCode);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);

  /**
   * Validates: Requirements 3.3
   *
   * 1xx informational status codes cause the Node.js HTTP client to
   * wait for a final response, resulting in a timeout. The handler
   * correctly returns healthy: false for these cases.
   */
  test('Property 2 (1xx): informational status codes return healthy: false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 199 }),
        async (statusCode) => {
          currentStatusCode = statusCode;

          const result = await handler({
            instanceIp: '127.0.0.1',
            port: serverPort,
            path: '/',
          });

          expect(result.healthy).toBe(false);
        },
      ),
      { numRuns: 5 },
    );
  }, 60_000);
});
