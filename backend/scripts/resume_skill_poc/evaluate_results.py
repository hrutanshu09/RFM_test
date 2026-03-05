import json
from pathlib import Path


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    base = Path(__file__).resolve().parent
    expected_dir = base / "expected"
    outputs_dir = base / "outputs"

    failures = []
    checks = 0

    for exp_file in sorted(expected_dir.glob("*.json")):
        expected = load_json(exp_file)
        resume_file = expected["resume"]
        out_file = outputs_dir / f"{Path(resume_file).stem}.analysis.json"
        if not out_file.exists():
            failures.append(f"missing output: {out_file.name}")
            continue

        analyzed = load_json(out_file)
        assessed = {
            row.get("skill", ""): row.get("level", "")
            for row in analyzed.get("skill_assessment", [])
        }

        for skill, rule in expected.get("expected", {}).items():
            checks += 1
            actual = assessed.get(skill, "<not found>")
            expected_level = rule.get("level")
            if actual != expected_level:
                failures.append(
                    f"{out_file.name}: {skill} expected={expected_level} actual={actual}"
                )

    if failures:
        print("[FAIL] outcome mismatches found")
        for f in failures:
            print(f"  - {f}")
        raise SystemExit(1)

    print(f"[PASS] all checks matched ({checks} checks)")


if __name__ == "__main__":
    main()
