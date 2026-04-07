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

info() {
    echo -e "${NC}[INFO]${NC} $*"
}

# Ensure ~/.codeg directory exists
ensure_config_dir() {
    mkdir -p "$(dirname "$PID_FILE")"
    mkdir -p "$(dirname "$TOKEN_FILE")"
}

# Setup Node.js environment (NVM, fnm, etc.) to ensure Agent CLIs are found
setup_node_env() {
    # Source NVM if available
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        # Load NVM without output
        \. "$HOME/.nvm/nvm.sh" --no-use 2>/dev/null || true
    fi

    # Source NVM bash completion if available
    if [ -s "$HOME/.nvm/bash_completion" ]; then
        \. "$HOME/.nvm/bash_completion" 2>/dev/null || true
    fi

    # Add NVM-managed Node paths to PATH (find all versions)
    if [ -d "$HOME/.nvm/versions/node" ]; then
        for version_dir in "$HOME/.nvm/versions/node"/*/; do
            if [ -d "${version_dir}bin" ]; then
                export PATH="${version_dir}bin:$PATH"
            fi
        done
    fi

    # Also add ~/.local/bin which may contain global npm packages
    export PATH="$HOME/.local/bin:$PATH"
}

# Get server binary path
get_server_binary() {
    local binary=""

    # Check ~/.local/bin first (symlinked from src-tauri)
    if [ -f "${HOME}/.local/bin/codeg-server" ]; then
        binary="${HOME}/.local/bin/codeg-server"
    # Check if running from source (development)
    elif [ -f "${SCRIPT_DIR}/../src-tauri/target/release/codeg-server" ]; then
        binary="${SCRIPT_DIR}/../src-tauri/target/release/codeg-server"
    elif [ -f "${SCRIPT_DIR}/../src-tauri/target/debug/codeg-server" ]; then
        binary="${SCRIPT_DIR}/../src-tauri/target/debug/codeg-server"
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
    # Setup Node.js environment for Agent CLIs (openclaw, claude-agent-acp, etc.)
    setup_node_env

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

    # Start server in background with environment variables
    ensure_config_dir

    # Build environment and run
    nohup env \
        ${CODEG_PORT:+CODEG_PORT=$CODEG_PORT} \
        ${CODEG_HOST:+CODEG_HOST=$CODEG_HOST} \
        ${CODEG_TOKEN:+CODEG_TOKEN=$CODEG_TOKEN} \
        ${CODEG_DATA_DIR:+CODEG_DATA_DIR=$CODEG_DATA_DIR} \
        ${CODEG_STATIC_DIR:+CODEG_STATIC_DIR=$CODEG_STATIC_DIR} \
        "$binary" \
        > "$LOG_FILE" 2>&1 &

    # Wait a moment for server to start
    sleep 2

    # Find the actual server process
    local new_pid
    new_pid=$(pgrep -f "codeg-server" | head -1 || true)

    if [ -n "$new_pid" ] && is_running "$new_pid"; then
        echo $new_pid > "$PID_FILE"
        success "codeg-server started (PID: $new_pid)"
        log "Log file: $LOG_FILE"

        # Extract and display listening addresses from log
        sleep 1
        local listening_lines
        listening_lines=$(grep -E "Listening on:" -A 10 "$LOG_FILE" 2>/dev/null | tail -n +2 | head -10)
        if [ -n "$listening_lines" ]; then
            echo ""
            info "Listening on:"
            echo "$listening_lines" | while IFS= read -r line; do
                [ -n "$line" ] && echo "  $line"
            done
        fi
        if [ -n "$CODEG_TOKEN" ]; then
            echo ""
            info "Auth Token: $CODEG_TOKEN"
        fi
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
    # Setup Node.js environment for Agent CLI checks
    setup_node_env

    # Load saved token
    local saved_token=""
    if [ -f "$TOKEN_FILE" ]; then
        saved_token=$(cat "$TOKEN_FILE")
    fi

    local pid
    pid=$(get_pid)

    if [ -n "$pid" ] && is_running "$pid"; then
        success "codeg-server is running (PID: $pid)"

        # Extract and display listening addresses from log
        local listening_lines
        listening_lines=$(grep -E "Listening on:" -A 10 "$LOG_FILE" 2>/dev/null | tail -n +2 | head -10)
        if [ -n "$listening_lines" ]; then
            echo ""
            info "Listening on:"
            echo "$listening_lines" | while IFS= read -r line; do
                [ -n "$line" ] && echo "  $line"
            done
        fi
        if [ -n "$saved_token" ]; then
            echo ""
            info "Auth Token: $saved_token"
        fi

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

    # Show Agent CLI availability
    echo ""
    info "Agent CLI status:"
    for cli in openclaw claude-agent-acp gemini cline codex-acp; do
        if command -v "$cli" &> /dev/null; then
            success "  $cli: $(command -v $cli)"
        else
            warn "  $cli: not found"
        fi
    done
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

# Build frontend only
do_build_frontend() {
    log "Building frontend..."

    # Check if pnpm is available
    if ! command -v pnpm &> /dev/null; then
        error "pnpm not found. Please install pnpm: npm install -g pnpm"
        exit 1
    fi

    # Get project root (parent of bin/)
    local project_root
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    cd "$project_root"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        info "Installing dependencies..."
        pnpm install
    fi

    # Build frontend
    pnpm build

    if [ $? -eq 0 ]; then
        success "Frontend built successfully"
        info "Output: ${project_root}/out/"
    else
        error "Frontend build failed"
        exit 1
    fi
}

# Build backend only
do_build_backend() {
    log "Building backend (codeg-server)..."

    # Get project root
    local project_root
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    local cargo_dir="${project_root}/src-tauri"

    # Check if cargo is available
    if ! command -v cargo &> /dev/null; then
        error "cargo not found. Please install Rust"
        exit 1
    fi

    # Build server binary (release mode, no default features for standalone server)
    cargo build --release --bin codeg-server --no-default-features --manifest-path "$cargo_dir/Cargo.toml"

    if [ $? -eq 0 ]; then
        local binary_path="${cargo_dir}/target/release/codeg-server"
        local dest_path="${HOME}/.local/bin/codeg-server"

        # Copy to ~/.local/bin for easy access (skip if same file)
        mkdir -p "${HOME}/.local/bin"
        if [ "$binary_path" -ef "$dest_path" ]; then
            info "Binary already in place: $dest_path"
        else
            cp "$binary_path" "$dest_path"
            chmod +x "$dest_path"
        fi

        success "Backend built successfully"
        info "Binary: $dest_path"
    else
        error "Backend build failed"
        exit 1
    fi
}

# Build both frontend and backend
do_build() {
    log "Building codeg (frontend + backend)..."

    do_build_frontend
    do_build_backend

    success "Build complete!"
    info "Frontend: ${project_root:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/out/"
    info "Backend: ${HOME}/.local/bin/codeg-server"
}

# Create deployment package
do_package() {
    log "Creating deployment package..."

    # Get project root
    local project_root
    project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local package_name="codeg-${timestamp}"
    local package_dir="/tmp/${package_name}"
    local dist_dir="${project_root}/dist"

    # Clean and create dist directory
    rm -rf "$dist_dir"
    mkdir -p "$dist_dir"

    # Create package directory
    mkdir -p "$package_dir"

    # Copy frontend build (out/) if exists
    if [ -d "${project_root}/out" ]; then
        cp -r "${project_root}/out" "$package_dir/"
        info "Added frontend (out/)"
    else
        warn "Frontend not built yet (run './codeg.sh build' first)"
    fi

    # Copy server binary
    if [ -f "${HOME}/.local/bin/codeg-server" ]; then
        cp "${HOME}/.local/bin/codeg-server" "$package_dir/"
        chmod +x "$package_dir/codeg-server"
        info "Added backend binary"
    elif [ -f "${project_root}/src-tauri/target/release/codeg-server" ]; then
        cp "${project_root}/src-tauri/target/release/codeg-server" "$package_dir/"
        chmod +x "$package_dir/codeg-server"
        info "Added backend binary"
    else
        warn "Backend binary not found"
    fi

    # Copy startup script
    cp "${BASH_SOURCE[0]}" "$package_dir/codeg.sh"
    chmod +x "$package_dir/codeg.sh"

    # Copy docker files if exist
    if [ -f "${project_root}/Dockerfile" ]; then
        cp "${project_root}/Dockerfile" "$package_dir/"
    fi
    if [ -f "${project_root}/docker-compose.yml" ]; then
        cp "${project_root}/docker-compose.yml" "$package_dir/"
    fi

    # Create README for deployment
    cat > "$package_dir/README.md" << 'READMEOF'
# Codeg Deployment Package

## Quick Start

1. Extract this package to your server
2. Run `./codeg.sh start` to start the server
3. Access the UI at http://localhost:3080

## Files

- `out/` - Frontend static files (serve with any static file server)
- `codeg-server` - Backend server binary
- `codeg.sh` - Management script

## Environment Variables

- `CODEG_PORT` - Server port (default: 3080)
- `CODEG_HOST` - Server host (default: 0.0.0.0)
- `CODEG_TOKEN` - Authentication token
- `CODEG_DATA_DIR` - Data directory
- `CODEG_STATIC_DIR` - Static files directory (default: ./out)

## Docker

```bash
docker-compose up -d
```

## Direct Usage

```bash
./codeg.sh start        # Start server
./codeg.sh stop         # Stop server
./codeg.sh status       # Check status
./codeg.sh set-token X  # Set auth token
```
READMEOF

    # Create tarball
    cd /tmp
    tar -czf "${dist_dir}/${package_name}.tar.gz" "$package_name"

    # Cleanup
    rm -rf "$package_dir"

    success "Package created: ${dist_dir}/${package_name}.tar.gz"

    # Also show size
    local size=$(du -h "${dist_dir}/${package_name}.tar.gz" | cut -f1)
    info "Package size: $size"
}

# Show usage
usage() {
    cat << EOF
codeg-server management script

Usage: ./codeg.sh <command>

Commands:
  build               Build both frontend and backend
  build-frontend      Build frontend only (pnpm build)
  build-backend       Build backend only (cargo build)
  package             Create deployment package (tarball)
  start               Start the server
  stop                Thoroughly stop the server (kill process tree)
  restart             Thoroughly restart the server
  set-token <TOKEN>   Set static authentication token
  status              Show server status
  token               Show current token
  help                Show this help message

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
        build)
            do_build
            ;;
        build-frontend)
            do_build_frontend
            ;;
        build-backend)
            do_build_backend
            ;;
        package)
            do_package
            ;;
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
