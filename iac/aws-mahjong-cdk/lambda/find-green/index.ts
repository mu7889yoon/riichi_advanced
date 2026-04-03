import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
} from '@aws-sdk/client-auto-scaling';
import {
  EC2Client,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import { findGreenFromInstances } from './logic';

const autoscaling = new AutoScalingClient({});
const ec2 = new EC2Client({});

interface FindGreenEvent {
  asgName: string;
  blueInstanceId: string;
}

interface FindGreenResult {
  found: boolean;
  instanceId?: string;
  publicIp?: string;
}

export async function handler(event: FindGreenEvent): Promise<FindGreenResult> {
  const { asgName, blueInstanceId } = event;

  const asgResult = await autoscaling.send(
    new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [asgName],
    }),
  );

  const instances = asgResult.AutoScalingGroups?.[0]?.Instances ?? [];
  const result = findGreenFromInstances(instances, blueInstanceId);

  if (!result.found) {
    return { found: false };
  }

  const ec2Result = await ec2.send(
    new DescribeInstancesCommand({
      InstanceIds: [result.instanceId!],
    }),
  );

  const publicIp = ec2Result.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;

  return {
    found: true,
    instanceId: result.instanceId!,
    publicIp,
  };
}
