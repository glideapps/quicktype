#!/usr/bin/env python

import argparse
import random

def random_array_element():
    return random.choice(['123', 'true', 'false', 'null', '3.1415', '"foo"'])

def main():
    parser = argparse.ArgumentParser(description="Generate a large JSON document.")
    parser.add_argument('--array-size', nargs=1, type=int, default=[100000])
    parser.add_argument('--array-type', choices=['int', 'array', 'object'], default='object')
    parser.add_argument('--array-elements', nargs=1, type=int, default=[3])
    parser.add_argument('--object-size', nargs=1, type=int, default=None)
    args = parser.parse_args()

    if args.object_size:
        print('{')
        for i in range(args.object_size[0] - 1):
            print('  "x%d": %s,' % (i, random_array_element()))
        print('  "no": "comma"')
        print('}')
    else:
        n = args.array_size[0]
        type = args.array_type
        print('{"x": [')
        if type == 'int':
            elem_format = "%d%s"
            need_i = True
        elif type == 'object':
            elem_format = '{"a": %d}%s'
            need_i = True
        elif type == 'array':
            nelems = args.array_elements[0]
            arr = []
            if nelems > 0:
                arr.append('%s')
            if nelems > 1:
                arr.extend([random_array_element() for _ in range(nelems-1)])
            elem_format = '[%s]%%s' % ", ".join(arr)
            need_i = nelems > 0
        else:
            raise Exception("Unknown array type %s" % type)
        for i in range(n):
            semicolon = "," if i < n-1 else ""
            if need_i:
                print(elem_format % (i, semicolon))
            else:
                print(elem_format % semicolon)
        print(']}')

if __name__ == "__main__":
    main()
