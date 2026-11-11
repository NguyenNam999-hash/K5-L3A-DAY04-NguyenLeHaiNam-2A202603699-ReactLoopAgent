#!/usr/bin/env python3
"""Build dashboard/data.js from the recorded eval artifacts.

Reads (read-only):
  evals/cases.json     -> core case metadata (question, scenario)
  eval_after.json      -> core recorded results + traces + judge grades
  bonus/cases.json     -> bonus case metadata
  eval_bonus.json      -> bonus recorded results + traces + judge grades

Writes:
  dashboard/data.js    -> window.DASHBOARD_DATA = {...}

Usage: python3 dashboard/build_data.py
"""
from __future__ import annotations

import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(__file__).resolve().parent / "data.js"

CORE_GROUPS = {
    "E": "EDGE CASES",
    "A": "ADVERSARIAL",
    "H": "HARD MODE",
}


def summarize(name: str, res: dict) -> str:
    """Compact, human-readable one-liner for a tool result."""
    if not isinstance(res, dict):
        return "result recorded"
    if res.get("ok") is False:
        return f'{res.get("error", "error")} — {res.get("message", "tool call failed")}'
    if name == "get_status" or name.endswith("_status"):
        overall = (res.get("overall") or {}).get("indicator", "?")
        incidents = res.get("incidents") or []
        comps = res.get("components") or []
        bits = [f"overall: {overall}", f"{len(incidents)} recent incidents"]
        if comps:
            bits.append("components: " + ", ".join(f'{c.get("name")}={c.get("status")}' for c in comps))
        else:
            bits.append("components: empty")
        return " · ".join(bits)
    if name == "get_incident_details":
        if res.get("id"):
            comps = ", ".join(res.get("components") or []) or "none"
            return f'{res["id"]} "{res.get("name", "")}" · {res.get("status", "?")} · components: {comps}'
        return "incident lookup failed"
    return "result recorded"


def build_cases(eval_file: pathlib.Path, cases_file: pathlib.Path, suite: str):
    meta = {c["id"]: c for c in json.loads(cases_file.read_text())}
    run = json.loads(eval_file.read_text())

    cases = []
    for item in run["cases"]:
        cid = item["id"]
        m = meta.get(cid, {})
        result = item.get("result") or {}
        grade = item.get("grade") or {}
        score = grade.get("score")
        mechanical = grade.get("mechanical") or {}

        trace = []
        for ev in result.get("trace") or []:
            if ev.get("event") != "tool":
                continue
            res = ev.get("result") or {}
            trace.append({
                "step": ev.get("step"),
                "name": ev.get("name"),
                "arguments": ev.get("arguments") or {},
                "ok": res.get("ok") is not False,
                "summary": summarize(ev.get("name"), res),
            })

        verdict = "passed" if result.get("status") == "completed" and (score or 0) >= 80 else "failed"

        if suite == "core":
            group = CORE_GROUPS.get(cid[0], "CASES")
            group_id = cid[0]
        else:
            group = "BONUS SUITE"
            group_id = "BONUS"

        cases.append({
            "id": cid,
            "suite": suite,
            "group": group_id,
            "groupLabel": group,
            "question": m.get("question") or item.get("question", ""),
            "expected": m.get("expected") or item.get("expected", ""),
            "scenario": item.get("scenario") or m.get("scenario") or "normal",
            "maxSteps": run.get("config", {}).get("max_steps"),
            "recordedStatus": result.get("status", "unknown"),
            "verdict": verdict,
            "score": score,
            "judgeStatus": grade.get("status"),
            "reason": grade.get("reason", ""),
            "improvement": grade.get("improvement", ""),
            "dimensions": grade.get("dimensions") or {},
            "toolCalls": mechanical.get("tool_calls", len(trace)),
            "toolSteps": mechanical.get("tool_steps", 0),
            "violations": mechanical.get("violations") or [],
            "answer": result.get("answer", ""),
            "trace": trace,
        })

    return cases, run


def main() -> None:
    core_cases, core_run = build_cases(
        ROOT / "eval_after.json", ROOT / "evals" / "cases.json", "core"
    )
    bonus_cases, bonus_run = build_cases(
        ROOT / "eval_bonus.json", ROOT / "bonus" / "cases.json", "bonus"
    )
    cases = core_cases + bonus_cases

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "evals/cases.json + eval_after.json + bonus/cases.json + eval_bonus.json",
        "dataset": "core+bonus",
        "config": core_run.get("config", {}),
        "summary": core_run.get("summary", {}),
        "bonusConfig": bonus_run.get("config", {}),
        "bonusSummary": bonus_run.get("summary", {}),
        "totalCases": len(cases),
        "suites": {
            "core": {"count": len(core_cases), "maxSteps": core_run.get("config", {}).get("max_steps")},
            "bonus": {"count": len(bonus_cases), "maxSteps": bonus_run.get("config", {}).get("max_steps")},
        },
        "cases": cases,
    }

    OUT.write_text(
        "/* Generated by dashboard/build_data.py — do not edit by hand. */\n"
        "window.DASHBOARD_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    print(
        f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB, "
        f"{len(core_cases)} core + {len(bonus_cases)} bonus)"
    )


if __name__ == "__main__":
    main()
