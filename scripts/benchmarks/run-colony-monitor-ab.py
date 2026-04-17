#!/usr/bin/env python3
import json
import os
import platform
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_ID = os.environ.get("COLONY_MONITOR_AB_RUN_ID", "run-2026-04-13")
OUT_DIR = ROOT / "docs" / "research" / "data" / "colony-monitor-ab" / RUN_ID
OUT_DIR.mkdir(parents=True, exist_ok=True)

ANT_COLONY_EXT = ROOT / "node_modules" / "@ifi" / "oh-pi-ant-colony" / "extensions" / "ant-colony" / "index.ts"
MONITORS_EXT = ROOT / "node_modules" / "@davidorex" / "pi-project-workflows" / "monitors-extension.ts"

TASKS = [
    {
        "id": "C1",
        "prompt": (
            "Use ant_colony to create a file named RESULT.txt with the exact text 'hello colony' "
            "in the repository root, then report completion."
        ),
        "expectedFiles": ["RESULT.txt"],
    },
    {
        "id": "C2",
        "prompt": (
            "Use ant_colony to create CHECKLIST.md with exactly three markdown checklist items "
            "for validating a tiny project, then report completion."
        ),
        "expectedFiles": ["CHECKLIST.md"],
    },
]

ARMS = [
    {
        "id": "A",
        "name": "monitors-on",
        "extensions": [MONITORS_EXT, ANT_COLONY_EXT],
    },
    {
        "id": "B",
        "name": "monitors-off",
        "extensions": [ANT_COLONY_EXT],
    },
]

PI_BIN = "pi.cmd" if platform.system().lower().startswith("win") else "pi"


def parse_json_events(output: str):
    events = []
    for line in output.splitlines():
        s = line.strip()
        if not s.startswith("{"):
            continue
        try:
            events.append(json.loads(s))
        except Exception:
            continue
    return events


def extract_notify_answer(output: str) -> str:
    m = re.findall(r"\x1b\]777;notify;π;(.+?)\x07", output, flags=re.S)
    return m[-1].strip() if m else ""


def prepare_workspace() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="colony-ab-"))
    (tmp / "README.md").write_text("# colony benchmark sandbox\n", encoding="utf-8")
    (tmp / "seed.txt").write_text("seed\n", encoding="utf-8")

    subprocess.run(["git", "init"], cwd=tmp, capture_output=True)
    return tmp


def run_task(arm: dict, task: dict):
    workspace = prepare_workspace()

    cmd = [PI_BIN, "--no-session", "--mode", "json", "--no-extensions"]
    for ext in arm["extensions"]:
        cmd.extend(["-e", str(ext)])

    cmd.extend(
        [
            "--append-system-prompt",
            "Always use ant_colony tool for this request. Keep it minimal with maxAnts=1.",
            "-p",
            task["prompt"],
        ]
    )

    t0 = time.perf_counter()
    timed_out = False
    exit_code = 0

    try:
        proc = subprocess.run(cmd, cwd=workspace, capture_output=True, timeout=540)
        stdout = (proc.stdout or b"").decode("utf-8", errors="ignore")
        stderr = (proc.stderr or b"").decode("utf-8", errors="ignore")
        output = stdout + ("\n" + stderr if stderr else "")
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as e:
        timed_out = True
        output = (e.stdout or b"").decode("utf-8", errors="ignore")
        exit_code = -1

    elapsed = round(time.perf_counter() - t0, 2)

    events = parse_json_events(output)
    tool_calls = []
    for e in events:
        if e.get("type") == "tool_execution_start":
            tname = e.get("toolName")
            if tname:
                tool_calls.append(tname)

    answer = ""
    for e in reversed(events):
        if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant":
            texts = [
                p.get("text", "")
                for p in e.get("message", {}).get("content", [])
                if p.get("type") == "text"
            ]
            if texts:
                answer = "\n".join(texts).strip()
                break
    if not answer:
        answer = extract_notify_answer(output)

    expected_ok = all((workspace / f).exists() for f in task["expectedFiles"])
    ant_called = "ant_colony" in tool_calls

    monitor_steer_count = output.count('"customType":"monitor-steer"')
    monitor_pending_count = output.count('"customType":"monitor-pending"')

    return {
        "taskId": task["id"],
        "prompt": task["prompt"],
        "elapsedSec": elapsed,
        "exitCode": exit_code,
        "timedOut": timed_out,
        "toolCalls": tool_calls,
        "toolCallsUnique": sorted(set(tool_calls)),
        "antColonyCalled": ant_called,
        "expectedFiles": task["expectedFiles"],
        "expectedFilesCreated": expected_ok,
        "monitorSteerCount": monitor_steer_count,
        "monitorPendingCount": monitor_pending_count,
        "assistantAnswer": answer,
        "workspace": str(workspace),
        "rawOutput": output,
    }


def main():
    run = {
        "runId": RUN_ID,
        "arms": [],
        "notes": {
            "sandbox": "Each task runs in an isolated temporary git repo",
            "antColonyExtension": str(ANT_COLONY_EXT),
            "monitorsExtension": str(MONITORS_EXT),
        },
    }

    for arm in ARMS:
        arm_res = {"id": arm["id"], "name": arm["name"], "tasks": []}

        for task in TASKS:
            res = run_task(arm, task)
            arm_res["tasks"].append({k: v for k, v in res.items() if k != "rawOutput"})
            (OUT_DIR / f"{arm['id']}-{task['id']}.log").write_text(res["rawOutput"], encoding="utf-8")

        tasks = arm_res["tasks"]
        success = sum(
            1
            for t in tasks
            if (not t["timedOut"]) and t["exitCode"] == 0 and t["antColonyCalled"] and t["expectedFilesCreated"]
        )
        timed_out_count = sum(1 for t in tasks if t["timedOut"])
        ant_called = sum(1 for t in tasks if t["antColonyCalled"])
        expected_created = sum(1 for t in tasks if t["expectedFilesCreated"])
        monitor_signals = sum(1 for t in tasks if (t["monitorSteerCount"] + t["monitorPendingCount"]) > 0)

        arm_res["metrics"] = {
            "taskCount": len(tasks),
            "successRate": round(success / len(tasks), 4) if tasks else 0,
            "avgElapsedSec": round(sum(t["elapsedSec"] for t in tasks) / len(tasks), 2) if tasks else 0,
            "timeoutRate": round(timed_out_count / len(tasks), 4) if tasks else 0,
            "antColonyCallRate": round(ant_called / len(tasks), 4) if tasks else 0,
            "expectedFilesRate": round(expected_created / len(tasks), 4) if tasks else 0,
            "monitorSignalRate": round(monitor_signals / len(tasks), 4) if tasks else 0,
            "avgMonitorSteerCount": round(sum(t["monitorSteerCount"] for t in tasks) / len(tasks), 2) if tasks else 0,
        }

        run["arms"].append(arm_res)

    (OUT_DIR / "results.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {
        "runId": RUN_ID,
        "arms": [{"id": a["id"], "name": a["name"], "metrics": a["metrics"]} for a in run["arms"]],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
