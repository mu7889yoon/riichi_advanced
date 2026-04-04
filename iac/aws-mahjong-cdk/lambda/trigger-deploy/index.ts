import {
  SFNClient,
  StartExecutionCommand,
  DescribeExecutionCommand,
} from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});

interface CfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceProperties: {
    StateMachineArn: string;
    Input: string;
    // Changes every deploy to force Custom Resource update
    DeployTrigger: string;
  };
}

interface CfnResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  Data?: Record<string, string>;
}

export async function handler(event: CfnEvent): Promise<void> {
  const physicalResourceId = `deploy-trigger-${event.LogicalResourceId}`;

  try {
    // On Delete, nothing to do
    if (event.RequestType === 'Delete') {
      await sendResponse(event, {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      });
      return;
    }

    const { StateMachineArn, Input } = event.ResourceProperties;

    // Start execution
    const startResult = await sfn.send(new StartExecutionCommand({
      stateMachineArn: StateMachineArn,
      input: Input,
    }));

    const executionArn = startResult.executionArn!;
    console.log(`Started execution: ${executionArn}`);

    // Poll until complete (max ~14 minutes to stay within Lambda 15min limit)
    const maxWaitMs = 14 * 60 * 1000;
    const pollIntervalMs = 10_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const desc = await sfn.send(new DescribeExecutionCommand({ executionArn }));
      const status = desc.status;

      if (status === 'SUCCEEDED') {
        console.log('Execution succeeded');
        await sendResponse(event, {
          Status: 'SUCCESS',
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          Data: { ExecutionArn: executionArn },
        });
        return;
      }

      if (status === 'FAILED' || status === 'TIMED_OUT' || status === 'ABORTED') {
        const cause = desc.cause ?? desc.error ?? 'Unknown error';
        console.error(`Execution ${status}: ${cause}`);
        await sendResponse(event, {
          Status: 'FAILED',
          Reason: `Step Functions execution ${status}: ${cause}`,
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
        });
        return;
      }

      // Still running, wait
      await sleep(pollIntervalMs);
    }

    // Timed out waiting
    await sendResponse(event, {
      Status: 'FAILED',
      Reason: `Timed out waiting for Step Functions execution: ${executionArn}`,
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    });
  } catch (err) {
    console.error('Error:', err);
    await sendResponse(event, {
      Status: 'FAILED',
      Reason: (err as Error).message,
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendResponse(event: CfnEvent, response: CfnResponse): Promise<void> {
  const body = JSON.stringify(response);
  console.log('Sending response:', body);

  const url = new URL(event.ResponseURL);
  const https = await import('node:https');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'PUT',
        headers: {
          'Content-Type': '',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
