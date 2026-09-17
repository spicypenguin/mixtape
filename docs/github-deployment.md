# GitHub Actions → S3

The workflow tests and builds pull requests. Pushes to `main` or `master` deploy only when that branch is the repository's default branch. Manual runs also deploy only from the default branch. Deployments are serialized and upload only five frontend files; they never delete objects or upload MP3s. HTML is uploaded last. This is not an atomic release: fixed-name assets can briefly differ during upload.

## One-time setup

1. The GitHub repository is `spicypenguin/mixtape`; the local `origin` uses `git@github.com:spicypenguin/mixtape.git`.
2. In GitHub **Settings → Environments**, create `production` and restrict deployment branches to your default branch. This restriction is important because the AWS trust policy below trusts this environment.
3. In AWS IAM, add the OpenID Connect provider `https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`, unless it already exists.
4. Create an IAM role with the trust policy below, replacing `ACCOUNT_ID` and `spicypenguin/mixtape`. Attach the permissions policy below, replacing the distribution ARN. No long-lived AWS keys are needed.
5. Under the GitHub `production` environment's **Variables**, configure:

| Variable | Value |
| --- | --- |
| `AWS_ROLE_ARN` | ARN of the IAM role created above (required) |
| `AWS_REGION` | `us-east-1` by default; override if needed |
| `S3_BUCKET` | `mixtape-tabletrash` by default; override if needed |
| `CLOUDFRONT_DISTRIBUTION_ID` | Existing CloudFront distribution ID; leave empty only if invalidation is unnecessary |

6. Run **Actions → Build and deploy to S3 → Run workflow** from the default branch. Future pushes deploy automatically.

The bucket and CloudFront distribution must already serve this site. The workflow does not change bucket public access, ACLs, DNS, or CloudFront origin settings. If CloudFront enforces a positive minimum cache TTL, invalidations still refresh these paths; use a zero minimum TTL to honor the frontend's revalidation headers.

## Role trust policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:spicypenguin/mixtape:environment:production"
    }}
  }]
}
```

## Role permissions policy

This permits writes only to the frontend keys. It does not permit deletion or audio writes. Change the bucket name if using an override. Remove the CloudFront statement if not using CloudFront. Buckets using a customer-managed KMS key also require the appropriate KMS encryption permissions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::mixtape-tabletrash/index.html",
        "arn:aws:s3:::mixtape-tabletrash/app.js",
        "arn:aws:s3:::mixtape-tabletrash/tracks.js",
        "arn:aws:s3:::mixtape-tabletrash/styles.css",
        "arn:aws:s3:::mixtape-tabletrash/favicon.svg"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
    }
  ]
}
```

## Updating tapes

Upload new MP3s separately, edit `config/tapes.json`, then push. Actions rebuilds `dist/tracks.js` from the catalog. The audio base URL remains `https://mixtape.ididthis.xyz/`; deploying the frontend alongside those MP3s preserves playback.

See [GitHub's AWS OIDC instructions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) and the [official AWS credential action](https://github.com/aws-actions/configure-aws-credentials).

