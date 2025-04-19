#!/bin/bash
set -e

# Store the root directory
ROOT_DIR="$(pwd)"

# Source and validate environment variables
source .env

# Required variables
PROJECT_NAME=${PROJECT_NAME:?"PROJECT_NAME is required"}
MACHINE_IP=${MACHINE_IP:?"MACHINE_IP is required"}
DEPLOY_PATH=${DEPLOY_PATH:?"DEPLOY_PATH is required"}
RESEND_KEY=${RESEND_KEY:?"RESEND_KEY is required"}

STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:?"STRIPE_SECRET_KEY is required"}
STRIPE_PUBLIC=${STRIPE_PUBLIC:?"STRIPE_PUBLIC is required"}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:?"STRIPE_WEBHOOK_SECRET is required"}

OPENROUTER_API_KEY=${OPENROUTER_API_KEY:?"OPENROUTER_API_KEY is required"}
OTEL_EXPORTER_OTLP_PROTOCOL=${OTEL_EXPORTER_OTLP_PROTOCOL:?"OTEL_EXPORTER_OTLP_PROTOCOL is required"}
OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:?"OTEL_EXPORTER_OTLP_ENDPOINT is required"}
OTEL_EXPORTER_OTLP_HEADERS=${OTEL_EXPORTER_OTLP_HEADERS:?"OTEL_EXPORTER_OTLP_HEADERS is required"}

echo "Starting local deployment for $PROJECT_NAME..."
echo "Machine IP: $MACHINE_IP"
echo "Deploy path: $DEPLOY_PATH"

# Build all applications first
echo "Building all applications..."

# Build main web
echo "Building main web..."
cd "$ROOT_DIR/web"
echo "Cleaning main web build..."
rm -rf dist node_modules/.vite
npm run build || { echo "❌ Main web build failed"; exit 1; }
echo "✅ Main web build successful"

# Build studio web
echo "Building studio web..."
cd "$ROOT_DIR/studio-web"
echo "Cleaning studio web build..."
rm -rf dist node_modules/.vite
npm run build || { echo "❌ Studio web build failed"; exit 1; }
echo "✅ Studio web build successful"

# Build backend
echo "Building backend..."
cd "$ROOT_DIR/api"
echo "Cleaning backend build..."
rm -rf bin obj
dotnet publish -c Release || { echo "❌ Backend build failed"; exit 1; }
echo "✅ Backend build successful"

echo "✅ All builds successful! Proceeding with deployment..."

# Package and deploy main web
echo "Packaging main web..."
cd "$ROOT_DIR/web"
tar czf web-dist.tar.gz -C dist .
scp web-dist.tar.gz root@$MACHINE_IP:/tmp/
rm web-dist.tar.gz

# Package and deploy studio web
echo "Packaging studio web..."
cd "$ROOT_DIR/studio-web"
tar czf studio-web-dist.tar.gz -C dist .
scp studio-web-dist.tar.gz root@$MACHINE_IP:/tmp/
rm studio-web-dist.tar.gz

# Package and deploy backend
echo "Packaging backend..."
cd "$ROOT_DIR/api/bin/Release/net9.0/publish"
tar czf api-dist.tar.gz *
scp api-dist.tar.gz root@$MACHINE_IP:/tmp/
rm api-dist.tar.gz

# Copy deployment files
echo "Copying deployment files..."
cd "$ROOT_DIR"
scp infra/scripts/deploy.sh root@$MACHINE_IP:/tmp/deploy.sh
scp infra/nginx/app.conf root@$MACHINE_IP:/tmp/app.conf

# Execute remote deployment with required variables
ssh root@$MACHINE_IP \
    PROJECT_NAME="$PROJECT_NAME" \
    MACHINE_IP="$MACHINE_IP" \
    DEPLOY_PATH="$DEPLOY_PATH" \
    ASPNETCORE_ENVIRONMENT="Production" \
    RESEND_KEY="$RESEND_KEY" \
    STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
    STRIPE_PUBLIC="$STRIPE_PUBLIC" \
    STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
    OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
    OTEL_SERVICE_NAME="$OTEL_SERVICE_NAME" \
    OTEL_EXPORTER_OTLP_PROTOCOL="$OTEL_EXPORTER_OTLP_PROTOCOL" \
    OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_EXPORTER_OTLP_ENDPOINT" \
    OTEL_EXPORTER_OTLP_HEADERS="$OTEL_EXPORTER_OTLP_HEADERS" \
    'bash /tmp/deploy.sh'

# Health check
echo "Performing health check..."
MAX_RETRIES=5
RETRY_COUNT=0
HEALTH_URL="http://$MACHINE_IP/api/health"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s -f "$HEALTH_URL" > /dev/null; then
        echo "✅ Health check passed! API is responding."
        echo "✅ Local deployment completed!"
        exit 0
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "Health check failed. Retrying in 5 seconds... (Attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

echo "❌ ERROR: Health check failed after $MAX_RETRIES attempts!"
exit 1 