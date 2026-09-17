#!/usr/bin/env bash
# Run in AWS CloudShell after cloning this repository.
set -euo pipefail
cd "$(dirname "$0")"
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == '325414188990' ]] || { echo 'Wrong AWS account'; exit 1; }
provider='arn:aws:iam::325414188990:oidc-provider/token.actions.githubusercontent.com'
providers=$(aws iam list-open-id-connect-providers --output json)
if ! jq -e --arg arn "$provider" '.OpenIDConnectProviderList[] | select(.Arn == $arn)' <<< "$providers" >/dev/null; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
fi
role='mixtape-github-deploy'
roles=$(aws iam list-roles --output json)
if jq -e --arg name "$role" '.Roles[] | select(.RoleName == $name)' <<< "$roles" >/dev/null; then
  echo "Role $role already exists. Inspect it before changing its trust or permissions."
  exit 1
fi
aws iam create-role --role-name "$role" --assume-role-policy-document file://github-trust-policy.json
aws iam put-role-policy --role-name "$role" --policy-name MixtapeFrontendUpload --policy-document file://github-s3-policy.json
echo 'Created role: arn:aws:iam::325414188990:role/mixtape-github-deploy'
echo 'CloudFront permissions must be added separately using the distribution ARN in docs/github-deployment.md.'
