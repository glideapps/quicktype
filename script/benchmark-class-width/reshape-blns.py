#!/usr/bin/env python3
"""Regroup blns-object.json into N contiguous groups per top-level object.

The generated code's cost is driven by the number of fields on a single class,
not by total code volume.  This rewrites the fixture so the same set of keys is
spread over more, narrower classes.

The `dontMakeAMap` sentinel is replicated into every group on purpose: an
all-string class with at least `stringMapSizeThreshold` (50) properties becomes
map-eligible in InferMaps.ts, so without a differently-typed property a group
would silently be inferred as a map instead of a class.

Usage:
    reshape-blns.py N [input.json] > output.json
"""

import json
import sys

SENTINEL = "dontMakeAMap"
DEFAULT_INPUT = "test/inputs/json/priority/blns-object.json"


def reshape(src, n):
    out = {}
    for name, obj in src.items():
        keys = [k for k in obj if k != SENTINEL]
        for i in range(n):
            chunk = keys[i * len(keys) // n : (i + 1) * len(keys) // n]
            group = {SENTINEL: True}
            group.update({k: obj[k] for k in chunk})
            out[f"{name}{i + 1}" if n > 1 else name] = group
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    n = int(sys.argv[1])
    path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_INPUT
    with open(path) as f:
        src = json.load(f)
    # ensure_ascii matches the checked-in file's \uXXXX escaping.
    print(json.dumps(reshape(src, n), indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
