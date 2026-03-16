import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'node:path';

export interface AwsMahjongCdkStackProps extends cdk.StackProps {
  certificateArn?: string;
  domainName?: string;
}

export class AwsMahjongCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsMahjongCdkStackProps = {}) {
    super(scope, id, props);

    const { certificateArn, domainName } = props;

    // --- VPC ---
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
    });

    // --- Secrets Manager ---
    const secretKeyBase = new secretsmanager.Secret(this, 'SecretKeyBase', {
      description: 'Phoenix SECRET_KEY_BASE for riichi-advanced',
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // --- Elastic IP ---
    const eip = new ec2.CfnEIP(this, 'EIP', {
      tags: [{ key: 'Name', value: 'riichi-advanced-eip' }],
    });

    new cdk.CfnOutput(this, 'ElasticIPAddress', { value: eip.ref });
    new cdk.CfnOutput(this, 'ElasticIPAllocationId', { value: eip.attrAllocationId });

    // --- IAM Instance Role ---
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:AssociateAddress'],
      resources: ['*'],
    }));

    // --- Docker Image Asset ---
    const dockerImage = new ecr_assets.DockerImageAsset(this, 'AppImage', {
      directory: path.join(__dirname, '../../../'),
      file: 'docker/deployment/Dockerfile',
      platform: ecr_assets.Platform.LINUX_ARM64,
    });

    dockerImage.repository.grantPull(instanceRole);
    secretKeyBase.grantRead(instanceRole);

    // --- Security Group ---
    const instanceSg = new ec2.SecurityGroup(this, 'InstanceSG', {
      vpc: vpc,
      description: 'Allow inbound on port 8080',
      allowAllOutbound: true,
    });

    instanceSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8080),
      'Allow HTTP 8080 inbound',
    );

    // --- UserData Script ---
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'exec > /var/log/user-data.log 2>&1',

      // Associate Elastic IP
      `INSTANCE_ID=$(ec2-metadata -i | cut -d" " -f2)`,
      `aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id ${eip.attrAllocationId} --region ${this.region}`,

      // Install Docker
      'yum update -y',
      'yum install -y docker',
      'systemctl enable docker',
      'systemctl start docker',

      // Login to ECR
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,

      // Fetch secret
      `SECRET_KEY_BASE=$(aws secretsmanager get-secret-value --secret-id ${secretKeyBase.secretArn} --query SecretString --output text --region ${this.region})`,
    );
    // docker run command is added after CloudFront distribution is created (needs PHX_HOST)

    // --- Launch Template ---
    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      instanceType: new ec2.InstanceType('c7g.xlarge'),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      role: instanceRole,
      securityGroup: instanceSg,
      userData: userData,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(30, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
        }),
      }],
      spotOptions: {},
    });

    // --- Auto Scaling Group ---
    new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc: vpc,
      launchTemplate: launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // --- CloudFront ---
    // Build EIP public DNS: ec2-{IP-with-dashes}.{region}.compute.amazonaws.com
    const eipDnsName = cdk.Fn.join('', [
      'ec2-',
      cdk.Fn.join('-', cdk.Fn.split('.', eip.ref)),
      `.${this.region}.compute.amazonaws.com`,
    ]);

    // Use placeholder for L2, override with dynamic DNS via escape hatch
    const origin = new origins.HttpOrigin('placeholder.compute.amazonaws.com', {
      httpPort: 8080,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    const assetsCachePolicy = new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
      defaultTtl: cdk.Duration.days(30),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const imagesCachePolicy = new cloudfront.CachePolicy(this, 'ImagesCachePolicy', {
      defaultTtl: cdk.Duration.days(30),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const svgsCachePolicy = new cloudfront.CachePolicy(this, 'SvgTilesCachePolicy', {
      defaultTtl: cdk.Duration.days(30),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const certificate = certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn)
      : undefined;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        '/assets/*': {
          origin: origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: assetsCachePolicy,
        },
        '/images/*': {
          origin: origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: imagesCachePolicy,
        },
        '/svgs/*': {
          origin: origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: svgsCachePolicy,
        },
      },
      ...(domainName && certificate ? {
        domainNames: [domainName],
        certificate: certificate,
      } : {}),
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    // Override placeholder origin domain with dynamic EIP DNS name
    const cfnDistribution = distribution.node.defaultChild as cdk.CfnResource;
    cfnDistribution.addOverride('Properties.DistributionConfig.Origins.0.DomainName', eipDnsName);

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });

    // Add docker run command now that we have the CloudFront domain for PHX_HOST
    const phxHost = domainName ?? distribution.distributionDomainName;
    userData.addCommands(
      // Run container
      `docker run -d --restart=always --name riichi-advanced \\`,
      `  -p 8080:8080 \\`,
      `  -e SECRET_KEY_BASE="$SECRET_KEY_BASE" \\`,
      `  -e PHX_HOST=${phxHost} \\`,
      `  ${dockerImage.imageUri}`,
    );
  }
}
