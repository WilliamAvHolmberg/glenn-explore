#!/bin/bash
set -e

# Validate required environment variables
: "${PROJECT_NAME:?'PROJECT_NAME is required'}"
: "${MACHINE_IP:?'MACHINE_IP is required'}"
: "${DEPLOY_PATH:?'DEPLOY_PATH is required'}"
: "${ASPNETCORE_ENVIRONMENT:?'ASPNETCORE_ENVIRONMENT is required'}"
: "${RESEND_KEY:?'RESEND_KEY is required'}"
: "${STRIPE_SECRET_KEY:?'STRIPE_SECRET_KEY is required'}"
: "${STRIPE_PUBLIC:?'STRIPE_PUBLIC is required'}"
: "${STRIPE_WEBHOOK_SECRET:?'STRIPE_WEBHOOK_SECRET is required'}"
: "${OPENROUTER_API_KEY:?'OPENROUTER_API_KEY is required'}"

echo "Starting remote deployment for $PROJECT_NAME..."
echo "Deploy path: $DEPLOY_PATH"
echo "Environment: $ASPNETCORE_ENVIRONMENT"
echo "Machine IP: $MACHINE_IP"

# Stop the service
echo "Stopping API service..."
sudo systemctl stop $PROJECT_NAME-api

# Backup database
echo "Backing up database..."
$DEPLOY_PATH/data/backup.sh

# Create data directory if it doesn't exist
echo "Setting up data directory..."
mkdir -p $DEPLOY_PATH/data
touch $DEPLOY_PATH/data/app.db
chmod 777 $DEPLOY_PATH/data  # Make directory fully accessible
chmod 666 $DEPLOY_PATH/data/app.db  # Make db file readable/writable
chown -R www-data:www-data $DEPLOY_PATH/data

# Deploy frontend
echo "Deploying frontend..."
rm -rf $DEPLOY_PATH/web/*
cd $DEPLOY_PATH/web
tar xzf /tmp/web-dist.tar.gz
rm /tmp/web-dist.tar.gz

# Deploy studio-web
echo "Deploying studio-web..."
rm -rf $DEPLOY_PATH/studio-web/*
mkdir -p $DEPLOY_PATH/studio-web
cd $DEPLOY_PATH/studio-web
tar xzf /tmp/studio-web-dist.tar.gz
rm /tmp/studio-web-dist.tar.gz

# Deploy backend
echo "Deploying backend..."
rm -rf $DEPLOY_PATH/api/*
cd $DEPLOY_PATH/api
tar xzf /tmp/api-dist.tar.gz
rm /tmp/api-dist.tar.gz

# Update systemd service with environment variables
echo "Updating systemd service..."
cat > /etc/systemd/system/$PROJECT_NAME-api.service << EOL
[Unit]
Description=$PROJECT_NAME API Service
After=network.target

[Service]
WorkingDirectory=$DEPLOY_PATH/api
ExecStart=/usr/bin/dotnet Api.dll
Restart=always
RestartSec=10
User=www-data
Environment=ASPNETCORE_ENVIRONMENT=$ASPNETCORE_ENVIRONMENT
Environment=DEPLOY_PATH=$DEPLOY_PATH
Environment=RESEND_KEY=$RESEND_KEY
Environment=OPENROUTER_API_KEY=$OPENROUTER_API_KEY
Environment=ELKS_API_USERNAME=$ELKS_API_USERNAME
Environment=ELKS_API_PASSWORD=$ELKS_API_PASSWORD
Environment=STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
Environment=STRIPE_PUBLIC=$STRIPE_PUBLIC
Environment=STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET

# Logging
StandardOutput=append:/var/log/$PROJECT_NAME-api.log
StandardError=append:/var/log/$PROJECT_NAME-api.error.log

# Core dump settings
LimitCORE=infinity
WorkingDirectory=$DEPLOY_PATH/api

[Install]
WantedBy=multi-user.target
EOL

# Create log files and set permissions
touch /var/log/$PROJECT_NAME-api.log
touch /var/log/$PROJECT_NAME-api.error.log
chown www-data:www-data /var/log/$PROJECT_NAME-api.log
chown www-data:www-data /var/log/$PROJECT_NAME-api.error.log

# Update Nginx configuration
echo "Updating Nginx configuration..."
envsubst '$MACHINE_IP $DEPLOY_PATH' < /tmp/app.conf > /etc/nginx/sites-available/$PROJECT_NAME

# Enable Nginx site
ln -sf /etc/nginx/sites-available/$PROJECT_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Set permissions
echo "Setting permissions..."
sudo chown -R www-data:www-data $DEPLOY_PATH

# Reload systemd and restart service
echo "Starting API service..."
sudo systemctl daemon-reload
sudo systemctl start $PROJECT_NAME-api

# Reload Nginx
echo "Reloading Nginx..."
sudo nginx -t && sudo systemctl reload nginx

# Verify deployment
echo "Verifying deployment..."
sudo systemctl status $PROJECT_NAME-api --no-pager
sudo nginx -t

echo "Remote deployment completed!" 