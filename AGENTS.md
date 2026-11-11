# AGENTS.md

## What this repo is

A Day 04 lab. The implementation target is `run_agent` in `agent.py`; tools, fixtures, and the eval harness are supplied and should be treated as fixed infrastructure. `providers.py` has one optional hook (`OPENAI_BASE_URL`) for OpenAI-compatible gateways; keep the default OpenAI URL intact.

- Python 3.10+, standard library only. No dependency install, no LangChain/LangGraph or other agent frameworks (`RULES.md`).
- `agent.py` now implements the full loop (source validation + injection sanitization). The starter baseline had 9 expected errors; the finished repo should be 37/37 tests green.
- Docs are in Vietnamese. `GUIDE.md` holds the full contract; `RULES.md` and `SUBMISSION.md` hold non-negotiable lab rules.

## Commands

```bash
# Offline tests (no API key). Fake providers; they check the loop contract, not model quality.
python3 -m unittest discover -s tests -v

# One test / one file
python3 -m unittest tests.test_lab.LoopTests.test_max_steps -v
python3 -m unittest discover -s tests -p 'test_lab.py' -v

# Bonus agent tests (separate directory; NOT covered by `discover -s tests`)
python3 -m unittest discover -s bonus -p 'test_*.py' -v

# Run the agent (needs PROVIDER, MODEL, and the matching provider key)
python3 run.py 'GitHub Actions hiện có sự cố không?'
python3 run.py --mode live 'Cloudflare có incident liên quan cache purge không?'
python3 run.py --bonus --max-steps 16 'Kiểm tra status GitHub, Vercel và npm.'

# Evals call a real LLM for both the agent and the judge; iterate with one case first
python3 evals/run_evals.py --case E2 --output eval_results_e2.json
python3 evals/run_evals.py --output eval_before.json
python3 evals/run_evals.py --bonus --output eval_bonus.json
```

Add `--provider`, `--model`, `--judge-provider`, `--judge-model`, or `--workers 2..8` to override defaults. Keep agent/judge/snapshot/max-steps configuration identical between `eval_before.json` and `eval_after.json`.

## Setup quirks

- `.env` is **not** auto-loaded. `cp .env.example .env` then `source .env` in every new shell, or export variables directly.
- `PROVIDER` is one of `openai`, `gemini`, `anthropic`, `openrouter`; `MODEL` is required and must support tool calling.
- For an OpenAI-compatible gateway, set `OPENAI_BASE_URL` (adapter appends `/chat/completions`). The local `.env` points at OpenCode Go (`https://opencode.ai/zen/go/v1`) with `deepseek-v4.1-flash`; the adapter sends `x-opencode-session` for `opencode.ai` URLs. The Go endpoint accepts any non-empty session id; `OPENCODE_SESSION_ID` is read from `.env`.
- Default `--mode` is `snapshot` (bundled fixtures, still needs an LLM key). `--mode live` calls public status APIs, can rate-limit/time out, and needs `STATUS_USER_AGENT` for polite contact info.
- Default `max_steps` differs: 6 for `run.py`, 8 for core evals, 16 for bonus evals. A step is one model call, not one tool call.

## `run_agent` contract (tests and grader depend on this)

- Signature: `run_agent(question, provider, tools, max_steps=6) -> dict` with at least `status` (`completed`, `max_steps`, `error`), `answer` (str), `trace` (list), `usage` (list); optional `error`.
- Append the assistant message **verbatim** before tool results, and send every tool result back with `{'role': 'tool', 'tool_call_id': <call id>, 'content': <JSON string>}`. Handle **all** calls in a response before the next model call.
- Trace tool events must be exactly `{'event': 'tool', 'step': n, 'name': ..., 'arguments': ..., 'result': ...}`. Tests match on `event`; the grader counts `name` and `step`.
- `finish == 'length'` or any non-`stop` finish with no calls is not completion: return `error`. A provider exception should end the run as `error`; tool failures should go back to the model as observations.
- Invalid tool-argument JSON must become an `INVALID_ARGUMENTS` observation, not a crash. Unknown tools and tool timeouts likewise return `{ok: false, ...}`.
- Use `getattr(tools, 'schemas', SCHEMAS)` and `getattr(tools, 'system_prompt', SYSTEM_PROMPT)`; `BonusTools` has different schemas (six provider-specific tools) and its own system prompt. Do not hardcode core tool names or incident IDs.
- Source validation is mandatory (`tests/test_validation.py`): remember URLs from successful `get_incident_details` results. If the final answer omits an observed incident URL, append an `event: 'validation_missing_source'` trace entry and ask the model to revise within the remaining budget. If the budget is exhausted, return `max_steps`. Do not require a URL when no incident lookup succeeded.

## Files that matter

- `status_tools.py` — core `get_status` / `get_incident_details`, `SCHEMAS`; snapshot data in `fixtures/`.
- `bonus/tools.py` — five provider status tools plus paginated `get_incident_details`; snapshot data in `bonus/fixtures/`.
- `providers.py` — OpenAI/Gemini/OpenRouter Chat Completions and Anthropic Messages adapters. Don't put loop logic here.
- `evals/run_evals.py` — runner; `evals/grading.py` — LLM judge + mechanical caps; `evals/scenarios.py` — eval-only fault injection.
- `tests/` — offline contract tests; `bonus/test_agent.py` — bonus loop tests.
- `NOTES.md` — submission analysis template; fill it from real traces, never fabricate evidence.

## Rules and gotchas

- **Do not edit** `fixtures/`, `evals/cases.json`, `evals/scenarios.py`, `evals/grading.py`, or rubric/expected data to make cases pass. Do not hand-edit eval output.
- `expected` is judge-only; never send it to the agent. Keep fault injection in `evals/scenarios.py`, not in shared tools.
- `--case` runs a single case; a single case is not a total score. `score_0_100` is `null` when any case is `unscored`; `partial_mean_0_100` is not the final score.
- `--bonus` is scored independently; `bonus_points_0_15` is non-null only for all 10 bonus cases.
- Snapshot data was captured 09–10/11/2026. Never present it as current real-world status.
- `get_status` matches substrings case-insensitively across only the 50 most recent incidents. An empty result does not prove an incident does not exist.
- Never commit `.env` or API keys, and scrub keys/account data from eval JSON and `NOTES.md` before submission.
- Final deliverables: completed `agent.py`, `eval_before.json`, `eval_after.json`, filled `NOTES.md`, plus `eval_bonus.json` if the bonus was attempted.
