#!/usr/bin/env python3
"""Tier 0: structural metrics for generated code.  No language toolchain needed.

For each candidate input, runs quicktype and reports how many types it produced
and how wide the widest one is.  Total field count is identical across
candidates, so a linear cost model predicts identical compile times; the widest
class is what drives the superlinear part.

Usage:
    measure.py --lang rust --src-lang json  bench/inputs/blns-*.json
    measure.py --lang python --src-lang schema bench/inputs/ku-*.schema
"""

import argparse
import os
import re
import subprocess
import sys

CLI = "dist/index.js"

# (type-opening regex, member-line regex) per language.
SHAPES = {
    "rust": (re.compile(r"^pub (struct|enum) (\w+)"), re.compile(r"^ +pub ")),
    "swift": (
        re.compile(r"^(?:public )?(?:final )?(?:struct|class|enum) (\w+)"),
        re.compile(r"^ +(?:public )?(?:let|var) "),
    ),
    "java": (
        re.compile(r"^(?:public )?(?:final )?class (\w+)"),
        re.compile(r"^ +private "),
    ),
    "typescript": (re.compile(r"^export interface (\w+)"), re.compile(r"^ +\w+\??:")),
    "dart": (re.compile(r"^class (\w+)"), re.compile(r"^ +(?:final )?\w+\??\s+\w+;")),
}


def generate(path, lang, src_lang):
    proc = subprocess.run(
        ["node", CLI, "--lang", lang, "--src-lang", src_lang, path],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"quicktype failed on {path}:\n{proc.stderr}")
    return proc.stdout


def widest_type(src, lang):
    opener, member = SHAPES[lang]
    types, widest, widest_name = 0, 0, None
    inside, count, name = False, 0, None
    for line in src.splitlines():
        m = opener.match(line)
        if m:
            inside, count, name = True, 0, m.groups()[-1]
            continue
        if inside:
            if member.match(line):
                count += 1
            elif line.startswith("}"):
                inside = False
                types += 1
                if count > widest:
                    widest, widest_name = count, name
    return types, widest, widest_name


def widest_call(src):
    """Widest call site — CPython rejects calls with more than 255 arguments."""
    best = 0
    for m in re.finditer(r"(\w+)\(((?:[^()]|\([^()]*\))*)\)", src):
        n = len([a for a in m.group(2).split(",") if a.strip()])
        best = max(best, n)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="rust")
    ap.add_argument("--src-lang", default="json")
    ap.add_argument("inputs", nargs="+")
    args = ap.parse_args()

    if not os.path.exists(CLI):
        sys.exit(f"{CLI} not found — run `npm run build` first")

    print(f"{'candidate':<24} {'lines':>7} {'types':>7} {'widest':>7}  widest type")
    print("-" * 68)
    for path in args.inputs:
        out = generate(path, args.lang, args.src_lang)
        lines = len(out.splitlines())
        if args.lang == "python":
            widest, types, name = widest_call(out), len(re.findall(r"^class ", out, re.M)), "(widest call site)"
        elif args.lang in SHAPES:
            types, widest, name = widest_type(out, args.lang)
        else:
            sys.exit(f"no shape rule for --lang {args.lang}")
        print(f"{os.path.basename(path):<24} {lines:>7} {types:>7} {widest:>7}  {name}")


if __name__ == "__main__":
    main()
