#!/usr/bin/env python3
import json
import os
import platform
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PI_AGENT_DIR = os.environ.get("PI_CODING_AGENT_DIR", "<default>")
OUT_DIR = ROOT / "docs" / "research" / "data" / "web-benchmark" / "run-2026-04-13"
RAW_DIR = OUT_DIR / "raw"
OUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)

TASKS = [
    {
        "id": "A1",
        "category": "quick-lookup",
        "prompt": "Qual é a versão estável mais recente do TypeScript e a data de release? Responda em até 5 bullets com URLs das fontes.",
    },
    {
        "id": "A2",
        "category": "quick-lookup",
        "prompt": "Resuma em 5 bullets as principais mudanças do Vite 7 e inclua URLs canônicas.",
    },
    {
        "id": "B1",
        "category": "deep-research",
        "prompt": "Como o TanStack Query decide stale state internamente? Traga explicação curta com permalink de código (arquivo + linhas).",
    },
    {
        "id": "B2",
        "category": "deep-research",
        "prompt": "No Next.js App Router, onde ocorre validação de cache tags? Traga arquivo e linhas com permalink.",
    },
    {
        "id": "C1",
        "category": "browser-automation",
        "prompt": "Abra a página npm do pacote vitest, identifique dependências declaradas e retorne uma lista curta com fonte.",
    },
    {
        "id": "C2",
        "category": "browser-automation",
        "prompt": "Navegue pela documentação do Vitest e traga um resumo do guia de mocking com URL exata.",
    },
]


def parse_events(output: str):
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


def extract_tools(events):
    tools = []
    for e in events:
        if e.get("type") == "tool_execution_start":
            t = e.get("toolName")
            if t:
                tools.append(t)
    return tools


def extract_notify_answer(output: str) -> str:
    # OSC 777 notify;π;<message>BEL
    matches = re.findall(r"\x1b\]777;notify;π;(.+?)\x07", output, flags=re.S)
    if matches:
        return matches[-1].strip()
    return ""


selected = os.environ.get("WEB_BENCH_TASKS")
if selected:
    allow = {x.strip() for x in selected.split(",") if x.strip()}
    TASKS = [t for t in TASKS if t["id"] in allow]

results = {
    "runId": "run-2026-04-13",
    "agentDir": str(PI_AGENT_DIR),
    "tasks": [],
}

env = os.environ.copy()
# Keep logs quieter
env["OH_PI_PLAIN_ICONS"] = "1"

PI_BIN = "pi.cmd" if platform.system().lower().startswith("win") else "pi"

for task in TASKS:
    cmd = [
        PI_BIN,
        "--no-session",
        "--mode",
        "json",
        "-p",
        task["prompt"],
    ]

    t0 = time.perf_counter()
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        env=env,
        capture_output=True,
        timeout=420,
    )
    elapsed = round(time.perf_counter() - t0, 2)

    stdout = (proc.stdout or b"").decode("utf-8", errors="ignore")
    stderr = (proc.stderr or b"").decode("utf-8", errors="ignore")
    output = stdout + ("\n" + stderr if stderr else "")
    (RAW_DIR / f"{task['id']}.log").write_text(output, encoding="utf-8")

    events = parse_events(output)
    tools = extract_tools(events)

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

    results["tasks"].append(
        {
            "id": task["id"],
            "category": task["category"],
            "prompt": task["prompt"],
            "elapsedSec": elapsed,
            "exitCode": proc.returncode,
            "toolCalls": tools,
            "toolCallsUnique": sorted(set(tools)),
            "assistantAnswer": answer,
        }
    )

(OUT_DIR / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

print(json.dumps({
    "runId": results["runId"],
    "tasks": [
        {
            "id": t["id"],
            "elapsedSec": t["elapsedSec"],
            "exitCode": t["exitCode"],
            "tools": t["toolCallsUnique"],
            "answerPreview": (t["assistantAnswer"] or "")[:120],
        }
        for t in results["tasks"]
    ],
}, ensure_ascii=False, indent=2))
