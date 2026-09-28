#!/usr/bin/env python3
"""Validate TFC artifacts and evaluate their acceptance rules.

This program consumes trusted runner/reviewer records. It does not authenticate
identities, execute verifiers, collect usage, or attest that a logged event occurred.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import sys
import tempfile
from typing import Any

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    print(json.dumps({"status": "invalid", "errors": [
        "Dependência ausente: instale requirements.txt com o mesmo Python."
    ]}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
MAX_JSON_BYTES = 16 * 1024 * 1024
EXPECTED_PRODUCER = {
    "deterministic": "runner", "runtime_observation": "runner",
    "human_review": "human", "llm_rubric": "model",
}


class InputError(ValueError):
    """Invalid, ambiguous, or unsupported input."""


def _object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"Chave JSON duplicada: {key}")
        result[key] = value
    return result


def _nonfinite(value: str) -> None:
    raise InputError(f"Número JSON não finito: {value}")


def read_json(path: Path) -> dict[str, Any]:
    if path.stat().st_size > MAX_JSON_BYTES:
        raise InputError(f"Arquivo JSON excede 16 MiB: {path.name}")
    data = json.loads(path.read_text(encoding="utf-8-sig"),
                      object_pairs_hook=_object_pairs, parse_constant=_nonfinite)
    if not isinstance(data, dict):
        raise InputError(f"Objeto JSON esperado: {path.name}")
    # Overflow such as 1e10000 must not turn into an accepted infinity.
    try:
        json.dumps(data, allow_nan=False)
    except ValueError as exc:
        raise InputError("Número JSON fora do intervalo finito suportado.") from exc
    return data


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=3)
def schema_validator(name: str) -> Draft202012Validator:
    schema = read_json(ROOT / "assets" / f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_schema(data: dict[str, Any], name: str) -> None:
    errors = sorted(schema_validator(name).iter_errors(data),
                    key=lambda error: str(list(error.absolute_path)))
    if errors:
        messages = []
        for error in errors[:12]:
            location = ".".join(map(str, error.absolute_path)) or "<root>"
            messages.append(f"{name}.{location}: {error.message}")
        raise InputError("\n".join(messages))


def index_by_id(items: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result = {}
    for item in items:
        if item["id"] in result:
            raise InputError(f"ID duplicado em {label}: {item['id']}")
        result[item["id"]] = item
    return result


def require_refs(refs: list[str], index: dict[str, Any], label: str) -> None:
    missing = sorted(set(refs) - set(index))
    if missing:
        raise InputError(f"Referências desconhecidas em {label}: {', '.join(missing)}")


def validate_contract(contract: dict[str, Any]) -> None:
    validate_schema(contract, "contract")
    sources = index_by_id(contract["sources"], "sources")
    verifiers = index_by_id(contract["verifiers"], "verifiers")
    index_by_id(contract["criteria"], "criteria")
    index_by_id(contract["unknowns"], "unknowns")
    index_by_id(contract["assumptions"], "assumptions")
    index_by_id(contract["optimization_metrics"], "optimization_metrics")
    require_refs(contract["objective"]["source_refs"], sources, "objective")
    environments = {env: True for env in contract["scope"]["environment_ids"]}
    for criterion in contract["criteria"]:
        label = criterion["id"]
        require_refs(criterion["source_refs"], sources, label)
        require_refs(criterion["verifier_ids"], verifiers, label)
        require_refs(criterion["environment_ids"], environments, label)
        if criterion["kind"] in {"hard_constraint", "regression"} and not criterion["required"]:
            raise InputError(f"Restrição ou regressão não pode ser opcional: {label}")
        if criterion["required"] and any(
            verifiers[v]["kind"] == "llm_rubric" for v in criterion["verifier_ids"]
        ):
            raise InputError(f"Juiz LLM não pode autorizar obrigação nesta V2: {label}")
    for kind in ("requirement", "regression"):
        if not any(c["required"] and c["kind"] == kind for c in contract["criteria"]):
            raise InputError(f"Falta condição obrigatória do tipo {kind}.")
    for unknown in contract["unknowns"]:
        require_refs(unknown["source_refs"], sources, unknown["id"])
        if unknown["status"] == "resolved" and (
            not unknown["resolution"].strip() or not unknown["source_refs"]
        ):
            raise InputError(f"Resolução sem justificativa e fonte: {unknown['id']}")
    for assumption in contract["assumptions"]:
        ref = assumption["decision_ref"]
        if ref is not None:
            require_refs([ref], sources, assumption["id"])
        if assumption["status"] in {"accepted", "rejected"} and ref is None:
            raise InputError(f"Decisão de hipótese sem fonte: {assumption['id']}")
    if contract["revision"] == 1 and contract["supersedes_sha256"] is not None:
        raise InputError("A primeira revisão não pode substituir uma revisão anterior.")
    if contract["revision"] > 1 and (
        contract["supersedes_sha256"] is None or not contract["change_reason"].strip()
    ):
        raise InputError("Uma revisão exige hash anterior e motivo da alteração.")


def qualification_issues(contract: dict[str, Any]) -> list[str]:
    issues = [f"unknown:{x['id']}" for x in contract["unknowns"]
              if x["blocking"] and x["status"] != "resolved"]
    issues += [f"assumption:{x['id']}" for x in contract["assumptions"]
               if x["status"] == "rejected" or
               (x["blocking"] and x["status"] != "accepted")]
    return issues


def parse_time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise InputError("Data sem timezone.")
    return result


def artifact_error(artifact: dict[str, str], evidence_root: Path) -> str | None:
    """Check a local artifact without executing or interpreting its contents."""
    relative = Path(artifact["path"])
    windows_path = PureWindowsPath(artifact["path"])
    if (relative.is_absolute() or windows_path.drive or
            ".." in relative.parts or ".." in windows_path.parts):
        return "unsafe_artifact_path"
    try:
        root = evidence_root.resolve(strict=True)
        candidate = (root / relative).resolve(strict=True)
        if not candidate.is_relative_to(root) or not candidate.is_file():
            return "artifact_outside_root_or_not_file"
        if sha256_file(candidate) != artifact["sha256"]:
            return "artifact_hash_mismatch"
    except (OSError, ValueError, RuntimeError):
        return "artifact_missing_or_unreadable"
    return None


def evaluate(contract: dict[str, Any], run: dict[str, Any], context: dict[str, Any],
             contract_sha256: str, evidence_root: Path) -> dict[str, Any]:
    """Evaluate a trusted snapshot. Caller owns authentication and atomicity."""
    validate_contract(contract)
    validate_schema(run, "run")
    validate_schema(context, "gate-context")
    if run["task_id"] != contract["task_id"] or context["task_id"] != contract["task_id"]:
        raise InputError("task_id diverge entre contrato, execução e contexto.")
    index_by_id(run["evidence"], "evidence")
    verifiers = index_by_id(contract["verifiers"], "verifiers")
    criteria_index = index_by_id(contract["criteria"], "criteria")
    producers = index_by_id(context["trusted_producers"], "trusted_producers")
    metrics = index_by_id(contract["optimization_metrics"], "optimization_metrics")
    for producer in producers.values():
        require_refs(producer["allowed_verifier_ids"], verifiers, producer["id"])
        if producer["id"] == context["implementer_id"]:
            raise InputError("O implementador não pode figurar como produtor confiável.")
    for event in run["evidence"]:
        if event["contract_sha256"] != contract_sha256:
            continue  # Historical records cannot authorize the current contract.
        require_refs([event["criterion_id"]], criteria_index, event["id"])
        criterion = criteria_index[event["criterion_id"]]
        if (event["verifier_id"] not in criterion["verifier_ids"] or
                event["environment_id"] not in criterion["environment_ids"]):
            raise InputError(f"Evidência aponta para par não previsto: {event['id']}")
    for measurement in run["measurements"]:
        require_refs([measurement["metric_id"]], metrics, "measurement")

    now = parse_time(context["evaluated_at"])
    current_candidate = context["current_candidate_id"]
    decision: dict[str, Any] = {
        "schema_version": "2.0", "task_id": contract["task_id"],
        "revision": contract["revision"], "contract_sha256": contract_sha256,
        "candidate_id": current_candidate, "evaluated_at": context["evaluated_at"],
        "status": "executing", "reasons": [], "criteria": [], "next_gaps": [],
        "required_summary": {"total": sum(c["required"] for c in contract["criteria"]),
                             "satisfied": 0, "unsatisfied": 0, "inconclusive": 0,
                             "unverified": sum(c["required"] for c in contract["criteria"])},
        "ignored_evidence": [], "measurements": [], "omitted_measurements": [],
        "unresolved_items": [x for x in contract["unknowns"] if x["status"] != "resolved"],
        "assumptions": contract["assumptions"], "usage": context["usage"],
        "limits": contract["budget"],
    }

    def finish(status: str, reasons: list[str]) -> dict[str, Any]:
        decision["status"] = status
        decision["reasons"] = reasons
        return decision

    # The context must itself come from a protected host, not from the implementer.
    if context["approval"]["approved_by"] == context["implementer_id"]:
        return finish("blocked", ["self_approval_not_allowed"])
    if context["approval"]["contract_sha256"] != contract_sha256:
        return finish("blocked", ["approved_contract_hash_mismatch"])
    if run["contract_sha256"] != contract_sha256:
        return finish("blocked", ["run_contract_hash_mismatch"])
    if context["stop_reason"] == "cancelled":
        return finish("cancelled", ["executor_cancelled"])
    if context["stop_reason"] == "budget_exhausted":
        return finish("truncated", ["executor_budget_exhausted"])
    if context["stop_reason"] == "external_blocker" or context["blockers"]:
        return finish("blocked", ["external_blocker", *context["blockers"]])

    budget = contract["budget"]
    usage = context["usage"]
    counters = [("iterations", "max_iterations"),
                ("elapsed_seconds", "max_elapsed_seconds"),
                ("no_progress_iterations", "max_no_progress_iterations"),
                ("tokens", "max_tokens"), ("cost_usd", "max_cost_usd")]
    missing_usage = [name for name, limit in counters
                     if budget[limit] is not None and usage[name] is None]
    if missing_usage:
        return finish("blocked", [f"missing_usage:{name}" for name in missing_usage])
    exceeded = [name for name, limit in counters
                if budget[limit] is not None and usage[name] > budget[limit]]
    if exceeded:
        return finish("truncated", [f"budget_exceeded:{name}" for name in exceeded])
    qualification = qualification_issues(contract)
    if qualification:
        return finish("qualifying", qualification)
    baseline_problem = artifact_error(contract["baseline"]["artifact"], evidence_root)
    if baseline_problem:
        return finish("blocked", [f"baseline:{baseline_problem}"])

    current_events = []
    for event in run["evidence"]:
        if event["contract_sha256"] != contract_sha256 or event["candidate_id"] != current_candidate:
            decision["ignored_evidence"].append({"id": event["id"], "reasons": ["stale_contract_or_candidate"]})
        else:
            current_events.append(event)

    def event_errors(event: dict[str, Any], criterion: dict[str, Any],
                     verifier: dict[str, Any]) -> list[str]:
        errors = []
        producer = producers.get(event["producer_id"])
        if (producer is None or verifier["id"] not in producer["allowed_verifier_ids"] or
                producer["kind"] != EXPECTED_PRODUCER[verifier["kind"]]):
            errors.append("unauthorized_producer")
        age = (now - parse_time(event["recorded_at"])).total_seconds()
        if age < 0:
            errors.append("future_evidence")
        # A known current-candidate failure does not vanish by aging out.
        elif age > verifier["max_age_seconds"] and event["result"] != "fail":
            errors.append("expired_evidence")
        if criterion["kind"] == "regression" and (
            event["baseline_candidate_id"] != contract["baseline"]["candidate_id"]
        ):
            errors.append("baseline_candidate_mismatch")
        for artifact in event["artifacts"]:
            problem = artifact_error(artifact, evidence_root)
            if problem:
                errors.append(problem)
        return sorted(set(errors))

    for criterion in contract["criteria"]:
        checks = []
        for verifier_id in criterion["verifier_ids"]:
            verifier = verifiers[verifier_id]
            for environment_id in criterion["environment_ids"]:
                matches = [event for event in current_events
                           if event["criterion_id"] == criterion["id"] and
                           event["verifier_id"] == verifier_id and
                           event["environment_id"] == environment_id]
                valid, invalid = [], []
                for event in matches:
                    problems = event_errors(event, criterion, verifier)
                    if problems:
                        invalid.append(event["id"])
                        decision["ignored_evidence"].append({"id": event["id"], "reasons": problems})
                    else:
                        valid.append(event)
                valid.sort(key=lambda event: (parse_time(event["recorded_at"]), event["id"]))
                failures = [e for e in valid if e["result"] == "fail"]
                passes = [e for e in valid if e["result"] == "pass"]
                if failures:
                    status = "unsatisfied"
                    reason = "conflicting_results" if passes else "verifier_failed"
                elif invalid:
                    status, reason = "inconclusive", "invalid_current_evidence"
                elif not valid:
                    status, reason = "unverified", "no_current_evidence"
                else:
                    latest_time = parse_time(valid[-1]["recorded_at"])
                    latest = [event for event in valid
                              if parse_time(event["recorded_at"]) == latest_time]
                    if all(event["result"] == "pass" for event in latest):
                        status, reason = "satisfied", "admissible_pass"
                    else:
                        status, reason = "inconclusive", "verifier_inconclusive"
                checks.append({"verifier_id": verifier_id, "environment_id": environment_id,
                               "status": status, "reason": reason,
                               "evidence_ids": [e["id"] for e in valid],
                               "invalid_evidence_ids": invalid})
        states = {check["status"] for check in checks}
        status = next(s for s in ("unsatisfied", "inconclusive", "unverified", "satisfied") if s in states)
        row = {"id": criterion["id"], "kind": criterion["kind"],
               "description": criterion["description"], "required": criterion["required"],
               "status": status, "checks": checks}
        decision["criteria"].append(row)
        if criterion["required"]:
            decision["required_summary"]["unverified"] -= 1
            decision["required_summary"][status] += 1
            if status != "satisfied":
                decision["next_gaps"].append({"criterion_id": criterion["id"],
                    "description": criterion["description"], "status": status,
                    "checks": [check for check in checks if check["status"] != "satisfied"]})

    for measurement in run["measurements"]:
        reasons = []
        if measurement["candidate_id"] != current_candidate:
            reasons.append("stale_candidate")
        if measurement["environment_id"] not in contract["scope"]["environment_ids"]:
            reasons.append("unknown_environment")
        if parse_time(measurement["recorded_at"]) > now:
            reasons.append("future_measurement")
        producer = producers.get(measurement["producer_id"])
        if not producer or producer["kind"] != "runner":
            reasons.append("unauthorized_measurement_producer")
        problem = artifact_error(measurement["artifact"], evidence_root)
        if problem:
            reasons.append(problem)
        if reasons:
            decision["omitted_measurements"].append({"metric_id": measurement["metric_id"], "reasons": reasons})
        else:
            metric = metrics[measurement["metric_id"]]
            decision["measurements"].append({**measurement, "unit": metric["unit"],
                                             "direction": metric["direction"]})

    summary = decision["required_summary"]
    accepted = summary["total"] > 0 and summary["satisfied"] == summary["total"]
    if accepted and not context["new_regressions"]:
        return finish("done", ["all_required_conditions_verified"])
    reached = [name for name, limit in counters
               if budget[limit] is not None and usage[name] >= budget[limit]]
    if reached:
        return finish("truncated", [f"budget_reached_without_acceptance:{name}" for name in reached])
    reasons = ["required_conditions_not_met"] if not accepted else []
    reasons += [f"new_regression:{finding}" for finding in context["new_regressions"]]
    return finish("executing", reasons)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Valida contratos e aplica regras de aceitação TFC V2.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("validate", "contract-hash", "evaluate"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--contract", type=Path, required=True)
        if name == "evaluate":
            cmd.add_argument("--run", type=Path, required=True)
            cmd.add_argument("--context", type=Path, required=True)
            cmd.add_argument("--evidence-root", type=Path, required=True)
            cmd.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    exit_code = 2
    output_allowed = False
    try:
        if args.command == "evaluate" and args.output:
            output_path = args.output.resolve()
            input_paths = {args.contract.resolve(), args.run.resolve(), args.context.resolve()}
            output_allowed = (output_path not in input_paths and
                              not output_path.is_relative_to(args.evidence_root.resolve()))
            if not output_allowed:
                raise InputError("A saída não pode sobrescrever entradas nem ficar na raiz de evidências.")
        contract = read_json(args.contract)
        validate_contract(contract)
        digest = sha256_file(args.contract)
        if args.command == "contract-hash":
            result = {"task_id": contract["task_id"], "contract_sha256": digest}
            exit_code = 0
        elif args.command == "validate":
            result = {"contract_valid": True, "task_id": contract["task_id"],
                      "revision": contract["revision"], "contract_sha256": digest,
                      "qualification_issues": qualification_issues(contract),
                      "note": "Validade estrutural não equivale a aprovação."}
            exit_code = 0
        else:
            result = evaluate(contract, read_json(args.run), read_json(args.context),
                              digest, args.evidence_root)
            exit_code = 0 if result["status"] == "done" else 3
    except (InputError, OSError, ValueError, RecursionError) as exc:
        result = {"status": "invalid", "errors": [str(exc)]}
        exit_code = 2
    text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if getattr(args, "output", None) and output_allowed:
        try:
            atomic_write(args.output, text)
        except OSError as exc:
            print(json.dumps({"status": "invalid", "errors": [f"Falha ao salvar saída: {exc}"]},
                             ensure_ascii=False))
            return 2
    print(text, end="")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
