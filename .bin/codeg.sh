#!/bin/bash
#
# codeg.sh - codeg-server management script
#
# Usage:
#   ./codeg.sh start              Start the server
#   ./codeg.sh stop               Thoroughly stop the server
#   ./codeg.sh restart            Thoroughly restart the server
#   ./codeg.sh set-token <TOKEN>  Set static authentication token
#   ./codeg.sh status             Show server status
#   ./codeg.sh token              Show current token
#
# Environment variables:
#   CODEG_PORT        Server port (default: 3080)
#   CODEG_HOST       Server host (default: 0.0.0.0)
#   CODEG_TOKEN      Authentication token
#   CODEG_DATA_DIR   Data directory
#   CODEG_STATIC_DIR Static files directory
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${CODG_PID_FILE:-${HOME}/.codeg/codeg-server.pid}"
LOG_FILE="${CODG_LOG_FILE:-${HOME}/.codeg/codeg-server.log}"
TOKEN_FILE="${HOME}/.codeg/.token"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

# Ensure ~/.codeg directory exists
ensure_config_dir() {
    mkdir -p "$(dirname "$PID_FILE")"
    mkdir -p "$(dirname "$TOKEN_FILE")"
}

# Get server binary path
get_server_binary() {
    local binary=""

    # Check if running from source (development)
    if [ -f "${SCRIPT_DIR}/src-tauri/target/release/codeg-server" ]; then
        binary="${SCRIPT_DIR}/src-tauri/target/release/codeg-server"
    elif [ -f "${SCRIPT_DIR}/src-tauri/target/debug/codeg-server" ]; then
        binary="${SCRIPT_DIR}/src-tauri/target/debug/codeg-server"
    # Check if installed system-wide
    elif command -v codeg-server &> /dev/null; then
        binary="codeg-server"
    else
        error "codeg-server binary not found"
        error "Please build with: cargo build --bin codeg-server --no-default-features --release"
        exit 1
    fi

    echo "$binary"
}

# Check if process is running
is_running() {
    local pid="$1"
    if [ -z "$pid" ]; then
        return 1
    fi
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Get PID from file
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

# Save PID to file
save_pid() {
    local pid="$1"
    ensure_config_dir
    echo "$pid" > "$PID_FILE"
}

# Clear PID file
clear_pid() {
    rm -f "$PID_FILE"
}

# Kill process tree thoroughly
kill_process_tree() {
    local pid="$1"
    local timeout="${2:-10}"

    if [ -z "$pid" ] || ! is_running "$pid"; then
        return 0
    fi

    log "Killing process tree for PID $pid..."

    # Try graceful shutdown first
    kill -TERM "$pid" 2>/dev/null || true

    # Wait for graceful shutdown
    local count=0
    while is_running "$pid" && [ $count -lt "$timeout" ]; do
        sleep 1
        count=$((count + 1))
    done

    # If still running, force kill
    if is_running "$pid"; then
        warn "Process $pid did not stop gracefully, forcing..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi

    # Double-check and kill any orphaned children
    if is_running "$pid"; then
        error "Failed to kill process $pid"
        return 1
    fi

    # Kill any remaining child processes
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
        log "Killing orphaned child process $child"
        (kill_process_tree "$child" 3) || true
    done

    clear_pid
    success "Process $pid and children stopped"
    return 0
}

# Find and kill all codeg-server processes
kill_all_instances() {
    log "Searching for all codeg-server instances..."

    local pids
    pids=$(pgrep -f "codeg-server" 2>/dev/null || true)

    if [ -z "$pids" ]; then
        log "No running instances found"
        return 0
    fi

    for pid in $pids; do
        warn "Found codeg-server process $pid, killing..."
        kill_process_tree "$pid" 10 || true
    done

    clear_pid
}

# Start the server
do_start() {
    local binary
    binary=$(get_server_binary)

    # Check if already running
    local current_pid
    current_pid=$(get_pid)
    if [ -n "$current_pid" ] && is_running "$current_pid"; then
        success "codeg-server is already running (PID: $current_pid)"
        return 0
    fi

    # Clean up stale PID file
    if [ -n "$current_pid" ]; then
        warn "Stale PID file found, clearing..."
        clear_pid
    fi

    log "Starting codeg-server..."
    log "Binary: $binary"
    log "PID file: $PID_FILE"
    log "Log file: $LOG_FILE"

    # Ensure log directory exists
    mkdir -p "$(dirname "$LOG_FILE")"

    # Load saved token if available and CODEG_TOKEN not set
    if [ -z "$CODEG_TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
        export CODEG_TOKEN=$(cat "$TOKEN_FILE")
        log "Using saved token from $TOKEN_FILE"
    fi

    # Start server in background
    ensure_config_dir

    nohup "$binary" \
        ${CODEG_PORT:+CODEG_PORT="$CODEG_PORT"} \
        ${CODEG_HOST:+CODEG_HOST="$CODEG_HOST"} \
        ${CODEG_TOKEN:+CODEG_TOKEN="$CODEG_TOKEN"} \
        ${CODEG_DATA_DIR:+CODEG_DATA_DIR="$CODEG_DATA_DIR"} \
        ${CODEG_STATIC_DIR:+CODEG_STATIC_DIR="$CODEG_STATIC_DIR"} \
        > "$LOG_FILE" 2>&1 &

    local new_pid=$!
    echo $new_pid > "$PID_FILE"

    # Wait a moment for server to start
    sleep 2

    if is_running "$new_pid"; then
        success "codeg-server started (PID: $new_pid)"
        log "Log file: $LOG_FILE"
    else
        error "Failed to start codeg-server"
        error "Check log: $LOG_FILE"
        clear_pid
        exit 1
    fi
}

# Stop the server thoroughly
do_stop() {
    log "Stopping codeg-server..."

    # First try PID file
    local pid
    pid=$(get_pid)

    if [ -n "$pid" ] && is_running "$pid"; then
        kill_process_tree "$pid" 10
    else
        # Try to find by process name
        warn "No PID file or process not running, searching by name..."
        kill_all_instances
    fi

    success "codeg-server stopped"
}

# Restart thoroughly (stop + start)
do_restart() {
    log "Restarting codeg-server..."
    do_stop
    sleep 2
    do_start
}

# Set static token
do_set_token() {
    local token="$1"

    if [ -z "$token" ]; then
        error "Token cannot be empty"
        exit 1
    fi

    ensure_config_dir
    echo "$token" > "$TOKEN_FILE"
    success "Static token saved to $TOKEN_FILE"

    # If server is running, prompt to restart
    local pid
    pid=$(get_pid)
    if [ -n "$pid" ] && is_running "$pid"; then
        warn "Server is running. Restart to apply new token:"
        warn "  ./codeg.sh restart"
    fi
}

# Show status
do_status() {
    local pid
    pid=$(get_pid)

    if [ -n "$pid" ] && is_running "$pid"; then
        success "codeg-server is running (PID: $pid)"

        # Show some info
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "Last log entries:"
            tail -5 "$LOG_FILE" 2>/dev/null || true
        fi
    else
        # Check if any instance is running
        local any_pid
        any_pid=$(pgrep -f "codeg-server" 2>/dev/null | head -1 || true)
        if [ -n "$any_pid" ]; then
            warn "codeg-server is running but not managed by this script (PID: $any_pid)"
        else
            info "codeg-server is not running"
        fi
    fi
}

# Show current token
do_token() {
    if [ -f "$TOKEN_FILE" ]; then
        echo "Static token: $(cat "$TOKEN_FILE")"
    elif [ -n "$CODEG_TOKEN" ]; then
        echo "Environment token: $CODEG_TOKEN"
    else
        warn "No token configured"
        echo "Use './codeg.sh set-token <TOKEN>' to set a static token"
    fi
}

# Show usage
usage() {
    cat << EOF
codeg-server management script

Usage: ./codeg.sh <command>

Commands:
  start              Start the server
  stop               Thoroughly stop the server (kill process tree)
  restart            Thoroughly restart the server
  set-token <TOKEN>  Set static authentication token
  status             Show server status
  token              Show current token
  help               Show this help message

Environment variables:
  CODEG_PORT        Server port (default: 3080)
  CODEG_HOST        Server host (default: 0.0.0.0)
  CODEG_TOKEN       Authentication token (overrides saved token)
  CODEG_DATA_DIR    Data directory
  CODEG_STATIC_DIR  Static files directory
  CODG_PID_FILE     PID file path (default: ~/.codeg/codeg-server.pid)
  CODG_LOG_FILE     Log file path (default: ~/.codeg/codeg-server.log)

Examples:
  ./codeg.sh start
  CODEG_PORT=8080 ./codeg.sh start
  ./codeg.sh set-token my-secret-token
  ./codeg.sh restart
  ./codeg.sh stop

EOF
}

# Main command dispatcher
main() {
    local command="${1:-}"

    case "$command" in
        start)
            do_start
            ;;
        stop)
            do_stop
            ;;
        restart)
            do_restart
            ;;
        set-token)
            do_set_token "${2:-}"
            ;;
        status)
            do_status
            ;;
        token)
            do_token
            ;;
        help|--help|-h)
            usage
            ;;
        "")
            usage
            ;;
        *)
            error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

main "$@"
