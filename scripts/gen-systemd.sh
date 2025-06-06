#!/bin/bash
# Create a systemd service that autostarts & manages a docker-compose instance in the current directory
# by Uli Köhler - https://techoverflow.net
# Licensed as CC0 1.0 Universal
SERVICENAME=sunce-multisig1

echo "Creating systemd service file... ${SERVICENAME}.service"
# Create systemd service file
sudo cat > $SERVICENAME.service <<EOF
[Unit]
Description=$SERVICENAME
Requires=docker.service
After=docker.service

[Service]
Restart=always
User=root
Group=docker
TimeoutStopSec=15
WorkingDirectory=$(pwd)
# Shutdown container (if running) when unit is started
ExecStartPre=$(which docker-compose) -f docker-compose.yml down
# Start container when unit is started
ExecStart=$(which docker-compose) -f docker-compose.yml up
# Stop container when unit is stopped
ExecStop=$(which docker-compose) -f docker-compose.yml down

[Install]
WantedBy=multi-user.target
EOF

echo "Copying to /etc/systemd/system/${SERVICENAME}.service"
sudo mv $SERVICENAME.service /etc/systemd/system/

echo "Enabling & starting $SERVICENAME"
# Autostart systemd service
#sudo systemctl enable $SERVICENAME.service
# Start systemd service now
#sudo systemctl start $SERVICENAME.service