import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'node:path';

interface AwsMahjongCdkStackProps extends cdk.StackProps {
  certificateArn: string;
  desiredCount?: number;
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

    const secretKeyBase = new secretsmanager.Secret(this, 'SecretKeyBase', {
      description: 'Phoenix SECRET_KEY_BASE for riichi-advanced',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    })

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn);

    // ElastiCache Serverless for Valkey
    const valkeySecurityGroup = new ec2.SecurityGroup(this, 'ValkeySecurityGroup', {
      vpc,
      description: 'Security group for Valkey cluster',
    });

    const publicSubnetIds = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds;

    const valkeySubnetGroup = new elasticache.CfnSubnetGroup(this, 'ValkeySubnetGroup', {
      description: 'Subnet group for Valkey',
      subnetIds: publicSubnetIds,
      cacheSubnetGroupName: 'riichi-advanced-valkey-subnet-group',
    });

    const valkeyCluster = new elasticache.CfnServerlessCache(this, 'ValkeyCluster', {
      engine: 'valkey',
      serverlessCacheName: 'riichi-advanced-valkey',
      securityGroupIds: [valkeySecurityGroup.securityGroupId],
      subnetIds: publicSubnetIds,
    });
    valkeyCluster.addDependency(valkeySubnetGroup);

    // Valkey endpoint for VALKEY_URL
    const valkeyEndpoint = cdk.Fn.join('', [
      'rediss://',
      valkeyCluster.attrEndpointAddress,
      ':',
      valkeyCluster.attrEndpointPort,
    ]);

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: cluster,
      memoryLimitMiB: 512,
      cpu: 256,
      desiredCount: props.desiredCount ?? 1,
      taskImageOptions: {
        image: image,
        containerPort: 8080,
        environment: {
          PHX_HOST: 'aws-mahjong.mu7889yoon-dev.click',
          VALKEY_URL: valkeyEndpoint,
        },
        secrets: {
          SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(secretKeyBase),
        },
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

    // Allow Fargate -> Valkey on port 6379
    valkeySecurityGroup.addIngressRule(
      service.service.connections.securityGroups[0],
      ec2.Port.tcp(6379),
      'Allow Fargate to Valkey',
    );

    service.targetGroup.setAttribute('stickiness.enabled', 'true');
    service.targetGroup.setAttribute('stickiness.type', 'app_cookie');
    service.targetGroup.setAttribute('stickiness.app_cookie.cookie_name', 'RIICHI_SESSION');
    service.targetGroup.setAttribute('stickiness.app_cookie.duration_seconds', '86400');
  }
}
