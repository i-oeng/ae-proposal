from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def _env_port(name: str, default: str) -> str:
    return os.getenv(name, default)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    api_host = os.getenv("API_HOST", "0.0.0.0")
    api_port = _env_port("API_PORT", "8000")
    frontend_host = os.getenv("FRONTEND_HOST", "0.0.0.0")
    frontend_port = _env_port("FRONTEND_PORT", "3000")

    frontend_env = os.environ.copy()
    frontend_env["HOSTNAME"] = frontend_host
    frontend_env["PORT"] = frontend_port

    processes = [
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                api_host,
                "--port",
                api_port,
            ],
            cwd=root,
        ),
        subprocess.Popen(
            ["node", "server.js"],
            cwd=root / "frontend",
            env=frontend_env,
        ),
    ]

    shutting_down = False

    def stop_processes(signum: int, _frame: object) -> None:
        # The container runtime sends SIGTERM; pass it through to both child processes.
        nonlocal shutting_down
        if shutting_down:
            return
        shutting_down = True
        for process in processes:
            if process.poll() is None:
                process.send_signal(signum)

    signal.signal(signal.SIGTERM, stop_processes)
    signal.signal(signal.SIGINT, stop_processes)

    try:
        while True:
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    stop_processes(signal.SIGTERM, None)
                    for other in processes:
                        if other is not process:
                            other.wait(timeout=15)
                    return return_code
            time.sleep(1)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
