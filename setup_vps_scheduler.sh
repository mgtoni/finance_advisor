#!/usr/bin/env bash
# ==============================================================================
# Automated 0-Supervision Scheduler Setup for IONOS VPS
# Sets up a self-healing systemd background service that starts on boot
# and automatically restarts on failures.
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="financial-scheduler"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "================================================================"
echo " Setting up Autonomous Zero-Supervision Scheduler on IONOS VPS"
echo " Project Directory: ${PROJECT_DIR}"
echo "================================================================"

# 1. Detect Python executable (venv or system)
if [ -f "${PROJECT_DIR}/venv/bin/python" ]; then
    PYTHON_EXEC="${PROJECT_DIR}/venv/bin/python"
elif [ -f "${PROJECT_DIR}/.venv/bin/python" ]; then
    PYTHON_EXEC="${PROJECT_DIR}/.venv/bin/python"
else
    PYTHON_EXEC="$(which python3)"
fi

echo "Using Python executable: ${PYTHON_EXEC}"

# 2. Check root permissions for systemd
if [ "$EUID" -ne 0 ]; then
    echo ""
    echo "Notice: Non-root user detected. Writing user systemd or crontab."
    echo "To install the official systemd service, run: sudo bash $0"
    echo ""
    echo "Alternative: 1-line crontab entry for your user:"
    echo "0 21 * * 1-5 cd ${PROJECT_DIR} && ${PYTHON_EXEC} run_task.py --task discovery --market usa >> ${PROJECT_DIR}/discovery.log 2>&1"
    exit 0
fi

# 3. Create Systemd Service File
cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=Quantitative Financial Advisor Autonomous Scheduler Daemon
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${PYTHON_EXEC} ${PROJECT_DIR}/vps_scheduler.py
Restart=always
RestartSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Created systemd service at: ${SERVICE_FILE}"

# 4. Reload and enable service
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo ""
echo "================================================================"
echo " [SUCCESS] ${SERVICE_NAME} is active and running with 0 supervision!"
echo " It will automatically start on VPS reboots and auto-restart on crashes."
echo ""
echo " Useful Commands:"
echo "   - View live logs:  journalctl -u ${SERVICE_NAME} -f"
echo "   - Check status:    systemctl status ${SERVICE_NAME}"
echo "   - Restart daemon:  systemctl restart ${SERVICE_NAME}"
echo "================================================================"
