#!/usr/bin/env bash
# Build Stacks as static files and upload them to the S3 + CloudFront setup in infra/stacks-static.yaml.
# Needs Docker and the AWS CLI (logged in). Usage: scripts/deploy-static.sh
# STACK and AWS_REGION choose the CloudFormation stack (defaults: stacks-static, us-east-1).
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-stacks-static}"
REGION="${AWS_REGION:-us-east-1}"
out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

BUCKET="$(out SiteBucket)"
DIST="$(out DistributionId)"
URL="$(out SiteUrl)"
echo "Deploying to s3://$BUCKET ($URL)"

# 1. Build inside Docker (type check, tests, the app without link previews, pinned and checksummed models).
rm -rf deploy
docker build --target static --output type=local,dest=deploy .

# Upload a folder with the right file types. Browsers refuse .wasm that isn't application/wasm.
# Extra args go last, so a caller's --exclude wins over the type filters.
put() { # put <local dir> <s3 prefix> <cache-control> [extra sync args…]
  local src="$1" dest="s3://$BUCKET/$2" cache="$3"
  shift 3
  aws s3 sync "$src" "$dest" --region "$REGION" --cache-control "$cache" --exclude '*' --include '*.wasm' --content-type application/wasm "$@"
  aws s3 sync "$src" "$dest" --region "$REGION" --cache-control "$cache" --exclude '*' --include '*.mjs' --content-type text/javascript "$@"
  aws s3 sync "$src" "$dest" --region "$REGION" --cache-control "$cache" --exclude '*.wasm' --exclude '*.mjs' "$@"
}

YEAR='public, max-age=31536000, immutable'
MONTH='public, max-age=2592000'

# 2. Models: kept by browsers for 30 days (like the Stacks server). --size-only, so the 400 MB model
#    is uploaded only when it actually changes, not because the build gave it a new date.
put deploy/models models "$MONTH" --size-only
# 3. Built code: every file name contains a hash of its contents, so it can be kept for a year.
put deploy/assets assets "$YEAR"
# 4. The page itself last, re-checked on every visit, so a new deploy shows up right away.
put deploy '' 'no-cache' --exclude 'models/*' --exclude 'assets/*'
# 5. Remove files from older builds.
#    Everything is already uploaded above, so this only deletes.
aws s3 sync deploy "s3://$BUCKET" --region "$REGION" --delete --size-only >/dev/null

# 6. Let CloudFront fetch the new files (one invalidation path, free up to 1,000 a month).
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query Invalidation.Id --output text >/dev/null

echo "Done: $URL"
