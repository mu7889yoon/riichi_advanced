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
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
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
    const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc: vpc,
      launchTemplate: launchTemplate,
      minCapacity: 1,
      maxCapacity: 2,
      desiredCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    new cdk.CfnOutput(this, 'ASGName', { value: asg.autoScalingGroupName });

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

    // =========================================================
    // Step Functions Blue/Green Deploy
    // =========================================================

    // --- Task 4.2: Health Check Lambda ---
    const healthCheckLambda = new lambda_nodejs.NodejsFunction(this, 'HealthCheckFunction', {
      entry: path.join(__dirname, '../lambda/health-check/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
    });

    // --- Find Green Instance Lambda ---
    const findGreenLambda = new lambda_nodejs.NodejsFunction(this, 'FindGreenFunction', {
      entry: path.join(__dirname, '../lambda/find-green/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
    });

    // Task 4.1: FindGreen Lambda needs ASG + EC2 permissions
    findGreenLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'autoscaling:DescribeAutoScalingGroups',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
    }));

    // --- Task 4.3: State Machine Main Flow ---

    // 1. GetDeploymentParams (Pass State)
    const getDeploymentParams = new sfn.Pass(this, 'GetDeploymentParams', {
      parameters: {
        'eipAllocationId.$': '$.eipAllocationId',
        'asgName.$': '$.asgName',
        'healthCheckPort.$': '$.healthCheckPort',
        'healthCheckPath.$': '$.healthCheckPath',
        'maxRetries.$': '$.maxRetries',
        'retryCount': 0,
      },
    });

    // 2. GetBlueInstanceId (SDK integration: EC2 DescribeAddresses)
    const getBlueInstanceId = new tasks.CallAwsService(this, 'GetBlueInstanceId', {
      service: 'ec2',
      action: 'describeAddresses',
      parameters: {
        AllocationIds: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.eipAllocationId')),
      },
      iamResources: ['*'],
      resultSelector: {
        'blueInstanceId.$': '$.Addresses[0].InstanceId',
      },
      resultPath: '$.blue',
    });

    // 3. SetDesiredCapacity2 (SDK integration: AutoScaling)
    const setDesiredCapacity2 = new tasks.CallAwsService(this, 'SetDesiredCapacity2', {
      service: 'autoscaling',
      action: 'setDesiredCapacity',
      parameters: {
        AutoScalingGroupName: sfn.JsonPath.stringAt('$.asgName'),
        DesiredCapacity: 2,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 4. WaitForGreenBoot + GetGreenInstanceId (polling loop)
    const waitForGreenBoot = new sfn.Wait(this, 'WaitForGreenBoot', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    const getGreenInstanceId = new tasks.LambdaInvoke(this, 'GetGreenInstanceId', {
      lambdaFunction: findGreenLambda,
      payload: sfn.TaskInput.fromObject({
        'asgName.$': '$.asgName',
        'blueInstanceId.$': '$.blue.blueInstanceId',
      }),
      resultSelector: {
        'found.$': '$.Payload.found',
        'instanceId.$': '$.Payload.instanceId',
        'publicIp.$': '$.Payload.publicIp',
      },
      resultPath: '$.green',
    });

    const checkGreenFound = new sfn.Choice(this, 'CheckGreenFound')
      .when(sfn.Condition.booleanEquals('$.green.found', true),
        // 5. GetGreenPublicIp — already have publicIp from findGreen Lambda
        new sfn.Pass(this, 'GreenFound'))
      .otherwise(waitForGreenBoot);

    // 5. We already have green.publicIp from the findGreen Lambda, so skip separate DescribeInstances

    // 6. HealthCheck (Lambda invoke + polling loop)
    const initHealthCheckRetry = new sfn.Pass(this, 'InitHealthCheckRetry', {
      result: sfn.Result.fromObject({}),
      resultPath: '$.healthResult',
    });

    const waitForHealthCheck = new sfn.Wait(this, 'WaitForHealthCheck', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(10)),
    });

    const healthCheck = new tasks.LambdaInvoke(this, 'HealthCheck', {
      lambdaFunction: healthCheckLambda,
      payload: sfn.TaskInput.fromObject({
        'instanceIp.$': '$.green.publicIp',
        'port.$': '$.healthCheckPort',
        'path.$': '$.healthCheckPath',
      }),
      resultSelector: {
        'healthy.$': '$.Payload.healthy',
      },
      resultPath: '$.healthResult',
    });

    const incrementRetryCount = new sfn.Pass(this, 'IncrementRetryCount', {
      parameters: {
        'eipAllocationId.$': '$.eipAllocationId',
        'asgName.$': '$.asgName',
        'healthCheckPort.$': '$.healthCheckPort',
        'healthCheckPath.$': '$.healthCheckPath',
        'maxRetries.$': '$.maxRetries',
        'retryCount.$': 'States.MathAdd($.retryCount, 1)',
        'blue.$': '$.blue',
        'green.$': '$.green',
        'healthResult.$': '$.healthResult',
      },
    });

    // 7. SwapEIP (SDK integration: EC2 AssociateAddress)
    const swapEip = new tasks.CallAwsService(this, 'SwapEIP', {
      service: 'ec2',
      action: 'associateAddress',
      parameters: {
        AllocationId: sfn.JsonPath.stringAt('$.eipAllocationId'),
        InstanceId: sfn.JsonPath.stringAt('$.green.instanceId'),
        AllowReassociation: true,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 8. TerminateBlue (SDK integration: EC2 TerminateInstances)
    const terminateBlue = new tasks.CallAwsService(this, 'TerminateBlue', {
      service: 'ec2',
      action: 'terminateInstances',
      parameters: {
        InstanceIds: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.blue.blueInstanceId')),
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 9. SetDesiredCapacity1 (SDK integration: AutoScaling)
    const setDesiredCapacity1 = new tasks.CallAwsService(this, 'SetDesiredCapacity1', {
      service: 'autoscaling',
      action: 'setDesiredCapacity',
      parameters: {
        AutoScalingGroupName: sfn.JsonPath.stringAt('$.asgName'),
        DesiredCapacity: 1,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 10. DeploySuccess
    const deploySuccess = new sfn.Succeed(this, 'DeploySuccess');

    // --- Task 4.4: Rollback Flow ---

    // Rollback: Restore EIP to Blue
    const rollbackRestoreEip = new tasks.CallAwsService(this, 'RollbackRestoreEIP', {
      service: 'ec2',
      action: 'associateAddress',
      parameters: {
        AllocationId: sfn.JsonPath.stringAt('$.eipAllocationId'),
        InstanceId: sfn.JsonPath.stringAt('$.blue.blueInstanceId'),
        AllowReassociation: true,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // Rollback: Terminate Green
    const rollbackTerminateGreen = new tasks.CallAwsService(this, 'RollbackTerminateGreen', {
      service: 'ec2',
      action: 'terminateInstances',
      parameters: {
        InstanceIds: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.green.instanceId')),
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    // Rollback: Set desired capacity back to 1
    const rollbackSetDesired1 = new tasks.CallAwsService(this, 'RollbackSetDesiredCapacity1', {
      service: 'autoscaling',
      action: 'setDesiredCapacity',
      parameters: {
        AutoScalingGroupName: sfn.JsonPath.stringAt('$.asgName'),
        DesiredCapacity: 1,
      },
      iamResources: ['*'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const deployFailed = new sfn.Fail(this, 'DeployFailed', {
      cause: 'Deployment failed, rolled back to Blue',
    });

    // Rollback chains
    rollbackRestoreEip.next(rollbackTerminateGreen);
    rollbackTerminateGreen.next(rollbackSetDesired1);
    rollbackSetDesired1.next(deployFailed);

    // Health check retry exceeded → rollback (terminate Green, no EIP restore needed)
    const healthCheckTimedOut = new sfn.Pass(this, 'HealthCheckTimedOut', {
      resultPath: '$.error',
      result: sfn.Result.fromObject({ cause: 'Health check max retries exceeded' }),
    });
    healthCheckTimedOut.next(rollbackTerminateGreen);

    // Health check result check
    const checkHealthResult = new sfn.Choice(this, 'CheckHealthResult')
      .when(sfn.Condition.booleanEquals('$.healthResult.healthy', true), swapEip)
      .when(
        sfn.Condition.numberGreaterThanEqualsJsonPath('$.retryCount', '$.maxRetries'),
        healthCheckTimedOut,
      )
      .otherwise(incrementRetryCount);

    // Wire health check polling loop
    incrementRetryCount.next(waitForHealthCheck);
    waitForHealthCheck.next(healthCheck);
    healthCheck.next(checkHealthResult);

    // Catch clauses (Task 4.4)
    // Before EIP swap: health check or setDesired2 failure → terminate Green → desired=1 → Fail
    setDesiredCapacity2.addCatch(rollbackTerminateGreen, { resultPath: '$.error' });

    // EIP swap failure → restore EIP to Blue → terminate Green → desired=1 → Fail
    swapEip.addCatch(rollbackRestoreEip, { resultPath: '$.error' });

    // Blue termination failure → desired=1 → Fail (EIP already on Green)
    terminateBlue.addCatch(rollbackSetDesired1, { resultPath: '$.error' });

    // Wire main flow
    const greenFoundState = getGreenInstanceId.next(checkGreenFound);
    waitForGreenBoot.next(greenFoundState);

    const definition = getDeploymentParams
      .next(getBlueInstanceId)
      .next(setDesiredCapacity2)
      .next(waitForGreenBoot);

    // GreenFound → initHealthCheckRetry → waitForHealthCheck → healthCheck → checkHealthResult
    // Re-wire: CheckGreenFound's "true" branch goes to health check init
    // We need to set the GreenFound pass state to chain into health check
    // The GreenFound pass state was created in the Choice; chain it forward
    const greenFoundNode = this.node.findChild('GreenFound') as sfn.Pass;
    greenFoundNode.next(initHealthCheckRetry);
    initHealthCheckRetry.next(waitForHealthCheck);

    // SwapEIP → TerminateBlue → SetDesiredCapacity1 → DeploySuccess
    swapEip.next(terminateBlue);
    terminateBlue.next(setDesiredCapacity1);
    setDesiredCapacity1.next(deploySuccess);

    // --- Task 4.5: Register State Machine ---
    const stateMachine = new sfn.StateMachine(this, 'DeployStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(15),
    });

    // Task 4.1: Grant Step Functions role the required permissions
    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeAddresses',
        'ec2:AssociateAddress',
        'ec2:DescribeInstances',
        'ec2:TerminateInstances',
        'autoscaling:SetDesiredCapacity',
        'autoscaling:DescribeAutoScalingGroups',
      ],
      resources: ['*'],
    }));
    healthCheckLambda.grantInvoke(stateMachine);
    findGreenLambda.grantInvoke(stateMachine);

    new cdk.CfnOutput(this, 'DeployStateMachineArn', {
      value: stateMachine.stateMachineArn,
    });

    // =========================================================
    // Custom Resource: Auto-trigger deploy on cdk deploy
    // =========================================================

    const triggerDeployLambda = new lambda_nodejs.NodejsFunction(this, 'TriggerDeployFunction', {
      entry: path.join(__dirname, '../lambda/trigger-deploy/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
    });

    stateMachine.grantStartExecution(triggerDeployLambda);
    stateMachine.grantRead(triggerDeployLambda);

    const deployInput = JSON.stringify({
      eipAllocationId: eip.attrAllocationId,
      asgName: asg.autoScalingGroupName,
      healthCheckPort: 8080,
      healthCheckPath: '/',
      maxRetries: 40,
    });

    new cdk.CustomResource(this, 'DeployTrigger', {
      serviceToken: triggerDeployLambda.functionArn,
      properties: {
        StateMachineArn: stateMachine.stateMachineArn,
        Input: deployInput,
        // Always trigger on every cdk deploy
        DeployTrigger: new Date().toISOString(),
      },
    });
  }
}
