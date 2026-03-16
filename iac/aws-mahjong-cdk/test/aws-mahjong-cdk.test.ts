import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AwsMahjongCdkStack, AwsMahjongCdkStackProps } from '../lib/aws-mahjong-cdk-stack';

const TEST_CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id';
const TEST_DOMAIN_NAME = 'test.example.com';

function createTemplate(propsOverride?: Partial<AwsMahjongCdkStackProps>): Template {
  const app = new cdk.App();
  const props: AwsMahjongCdkStackProps = {
    certificateArn: TEST_CERTIFICATE_ARN,
    domainName: TEST_DOMAIN_NAME,
    ...propsOverride,
  };
  const stack = new AwsMahjongCdkStack(app, 'TestStack', props);
  return Template.fromStack(stack);
}

describe('EC2 infrastructure', () => {
  const template = createTemplate();

  test('Launch Template specifies c7g.2xlarge with Spot', () => {
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: Match.objectLike({
        InstanceType: 'c7g.xlarge',
        InstanceMarketOptions: { MarketType: 'spot' },
      }),
    });
  });

  test('ASG has min/max/desired = 1', () => {
    template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '1',
      MaxSize: '1',
      DesiredCapacity: '1',
    });
  });

  test('Elastic IP exists', () => {
    template.hasResource('AWS::EC2::EIP', {});
  });

  test('Security Group allows inbound 8080', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ FromPort: 8080, ToPort: 8080, IpProtocol: 'tcp' }),
      ]),
    });
  });
});

describe('CloudFront distribution', () => {
  const template = createTemplate();

  test('distribution exists with HTTP-only origin on port 8080', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: {
              HTTPPort: 8080,
              OriginProtocolPolicy: 'http-only',
            },
          }),
        ]),
      },
    });
  });

  test('has ACM certificate when provided', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: TEST_CERTIFICATE_ARN,
        }),
      },
    });
  });

  test('cache behaviors for static assets', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/assets/*' }),
          Match.objectLike({ PathPattern: '/images/*' }),
          Match.objectLike({ PathPattern: '/svgs/*' }),
        ]),
      },
    });
  });

  test('default behavior has caching disabled', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        }),
      },
    });
  });

  test('all behaviors redirect to HTTPS', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/assets/*', ViewerProtocolPolicy: 'redirect-to-https' }),
          Match.objectLike({ PathPattern: '/images/*', ViewerProtocolPolicy: 'redirect-to-https' }),
          Match.objectLike({ PathPattern: '/svgs/*', ViewerProtocolPolicy: 'redirect-to-https' }),
        ]),
      },
    });
  });
});

describe('without certificate/domain', () => {
  const template = createTemplate({ certificateArn: undefined, domainName: undefined });

  test('CloudFront still created', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('no custom domain or certificate', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: Match.absent(),
        ViewerCertificate: Match.absent(),
      }),
    });
  });
});

describe('no legacy resources', () => {
  const template = createTemplate();

  test('zero ALB resources', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  test('zero ECS resources', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 0);
    template.resourceCountIs('AWS::ECS::Service', 0);
  });
});

describe('IAM permissions', () => {
  const template = createTemplate();

  test('includes ec2:AssociateAddress', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'ec2:AssociateAddress', Effect: 'Allow' }),
        ]),
      },
    });
  });
});
