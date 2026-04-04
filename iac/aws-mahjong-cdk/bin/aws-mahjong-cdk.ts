#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AwsMahjongCdkStack } from '../lib/aws-mahjong-cdk-stack';

const app = new cdk.App();

const certificateArn = app.node.tryGetContext('certificateArn');
const domainName = app.node.tryGetContext('domainName');

new AwsMahjongCdkStack(app, 'AwsMahjongCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  certificateArn: certificateArn,
  domainName: domainName,
});
