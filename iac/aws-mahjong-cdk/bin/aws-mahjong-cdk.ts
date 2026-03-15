#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AwsMahjongCdkStack } from '../lib/aws-mahjong-cdk-stack';

const app = new cdk.App();

// cdk deploy -c certificateArn=arn:aws:acm:... で渡す
const certificateArn = app.node.tryGetContext('certificateArn');
if (!certificateArn) {
  throw new Error('certificateArn is required. Usage: cdk deploy -c certificateArn=arn:aws:acm:...');
}

new AwsMahjongCdkStack(app, 'AwsMahjongCdkStack2', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  certificateArn: certificateArn,
});
