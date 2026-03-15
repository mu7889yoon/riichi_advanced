import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as path from 'node:path';

interface AwsMahjongCdkStackProps extends cdk.StackProps {
  certificateArn: string;
}

export class AwsMahjongCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsMahjongCdkStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
      enableFargateCapacityProviders: true,
    })

    const image = ecs.ContainerImage.fromAsset(path.join(__dirname, '../../../'), {
      file: 'docker/deployment/Dockerfile',
    })

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn);

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: cluster,
      memoryLimitMiB: 2048,
      cpu: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: image,
        containerPort: 80,
        command: ['mix', 'phx.server'],
      },
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      certificate: certificate,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      redirectHTTP: true,
      assignPublicIp: true,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
      ],
    })

    service.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200-499',
      interval: cdk.Duration.seconds(300),
      timeout: cdk.Duration.seconds(120),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 10,
    })
  }
}
