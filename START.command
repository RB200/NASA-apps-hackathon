#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
project_dir="$(pwd -P)"

backend_pid=
frontend_pid=
rover_pid=
cleanup() {
  for pid in "$rover_pid" "$frontend_pid" "$backend_pid"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

rover_port=5175
stop_old_server() {
  local port=$1 service=$2 pid command cwd owner attempt targets=
  for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN | sort -u); do
    command=$(ps -ww -p "$pid" -o command=) || continue
    # Uvicorn's reload worker can share the listening socket with its parent.
    if [[ "$service" == backend && "$command" == *multiprocessing.spawn* ]]; then
      pid=$(ps -p "$pid" -o ppid= | tr -d '[:space:]')
      command=$(ps -ww -p "$pid" -o command=) || continue
    fi
    owner=$(ps -p "$pid" -o uid= | tr -d '[:space:]')
    cwd=$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')
    [[ "$owner" == "$UID" && "$cwd" == "$project_dir" ]] || return 1
    case "$service:$command" in
      backend:*' -m uvicorn app:app '*|backend:*'/uvicorn app:app '*) ;;
      static:*" -m http.server $port "*|static:*" -m http.server $port") ;;
      *) return 1 ;;
    esac
    case " $targets " in
      *" $pid "*) ;;
      *) targets="${targets:+$targets }$pid" ;;
    esac
  done
  if [[ -n "$targets" ]]; then
    echo "Stopping old project server on port ${port}..."
    for pid in $targets; do kill -TERM "$pid" 2>/dev/null || true; done
  fi
  for ((attempt = 0; attempt < 50; attempt++)); do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  return 1
}

stop_old_server 8000 backend || { echo "Could not free backend port 8000."; exit 1; }
stop_old_server "$rover_port" static || { echo "Could not free rover port $rover_port."; exit 1; }

frontend_port=5173
while [[ "$frontend_port" -eq "$rover_port" ]] ||
  ! stop_old_server "$frontend_port" static; do
  frontend_port=$((frontend_port + 1))
done

venv=.venv/lunar-map
if [[ ! -x "$venv/bin/python" ]]; then
  launcher=
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; sys.exit(not ((3, 10) <= sys.version_info[:2] <= (3, 12)))'; then
      launcher=$candidate
      break
    fi
  done
  if [[ -z "$launcher" ]]; then
    echo "Install Python 3.12 and make it available in Terminal, then reopen START.command."
    exit 1
  fi
  "$launcher" -m venv "$venv"
fi

python="$venv/bin/python"
echo "Checking backend dependencies…"
"$python" -B -m pip install --quiet --disable-pip-version-check --no-compile -r backend/requirements.txt

PYTHONDONTWRITEBYTECODE=1 "$python" -B -m uvicorn app:app --app-dir backend --reload --reload-dir backend --host 127.0.0.1 --port 8000 &
backend_pid=$!
"$python" -B -m http.server "$frontend_port" --bind 127.0.0.1 --directory frontend &
frontend_pid=$!
"$python" -B -m http.server "$rover_port" --bind 127.0.0.1 &
rover_pid=$!

url="http://127.0.0.1:$frontend_port/?welcome=1"
rover_url="http://127.0.0.1:$rover_port/lunar-rover-simulation/frontend/terrain.html"
for ((attempt = 0; attempt < 75; attempt++)); do
  if ! kill -0 "$backend_pid" "$frontend_pid" "$rover_pid" 2>/dev/null; then
    echo "A server could not start. See the error above."
    exit 1
  fi
  if curl --silent --fail --max-time 1 http://127.0.0.1:8000/health >/dev/null &&
    curl --silent --fail --max-time 1 "$url" >/dev/null &&
    curl --silent --fail --max-time 1 "$rover_url" >/dev/null; then
    echo "Lunar map: $url"
    echo "Rover simulator: $rover_url"
    echo "Press Ctrl+C to stop all three servers."
    open "$url" || true
    while kill -0 "$backend_pid" "$frontend_pid" "$rover_pid" 2>/dev/null; do sleep 1; done
    echo "A server stopped. See the output above."
    exit 1
  fi
  sleep 0.2
done

echo "The servers did not become ready. See the output above."
exit 1
