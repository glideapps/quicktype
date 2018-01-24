#!/usr/bin/env python

import argparse

with open('keywords.txt') as f:
    keywords = f.read().splitlines()

def generate_classes():
    print('{')
    for kw in keywords:
        print('  "%s": { "%s": 123 },' % (kw, kw))
    print('  "dummy": 123')
    print('}')

def generate_enum_schema():
    print('{')
    print('  "type": "object",')
    print('  "properties": {')
    print('    "enum": {')
    print('      "type": "string",')
    print('      "enum": [')
    for kw in keywords:
        print('        "%s",' % kw)
    print('        "dummy"')
    print('      ],')
    print('      "title": "enum"')
    print('    }')
    print('  }')
    print('}')

def generate_union_schema():
    print('{')
    print('    "type": "object",')
    print('    "properties": {')
    for kw in keywords:
        print('        "%s": {' % kw)
        print('            "oneOf": [')
        print('                { "type": "number" },')
        print('                { "type": "object", "additionalProperties": false, "title": "%s" }' % kw)
        print('            ],')
        print('            "title": "union_%s"' % kw)
        print('        },')
    print('        "dummy": { "type": "number" }')
    print('    }')
    print('}')

def main():
    parser = argparse.ArgumentParser(
        description="Generate a JSON document with lots of potential keywords.")
    parser.add_argument('--enums', action="store_true")
    parser.add_argument('--unions', action="store_true")
    args = parser.parse_args()

    if args.enums:
        generate_enum_schema()
    elif args.unions:
        generate_union_schema()
    else:
        generate_classes()

if __name__ == "__main__":
    main()
