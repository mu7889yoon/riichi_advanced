import http from 'node:http';

interface HealthCheckEvent {
  instanceIp: string;
  port: number;
  path: string;
}

interface HealthCheckResult {
  healthy: boolean;
  statusCode?: number;
  error?: string;
}

export async function handler(event: HealthCheckEvent): Promise<HealthCheckResult> {
  const { instanceIp, port, path } = event;
  const url = `http://${instanceIp}:${port}${path}`;

  try {
    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });

    return {
      healthy: statusCode === 200,
      statusCode,
    };
  } catch (err) {
    return {
      healthy: false,
      error: (err as Error).message,
    };
  }
}
