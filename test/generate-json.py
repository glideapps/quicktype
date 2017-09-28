#!/usr/bin/env python

import argparse
import random
import json
import sys

with open('/usr/share/dict/words') as f:
    words = f.read().splitlines()


def random_array_element():
    return random.choice(['123', 'true', 'false', 'null', '3.1415', '"foo"'])


def random_word():
    return random.choice(words)


def print_object(size, indent, suffix):
    print(indent + '{')
    for i in range(size - 1):
        print(indent + '  "%s": %s,' % (random_word(), random_array_element()))
    print(indent + '  "%s": "no-comma"' % random_word())
    print(indent + '}' + suffix)


def produce_null():
    return "null"


def produce_int():
    return str(random.randint(-1000, 1000))


def produce_float():
    return str(random.random() * 2000 - 1000)


def produce_bool():
    return random.choice(['false', 'true'])


def produce_string():
    return '"' + random_word() + '"'


def make_produce_random(producers):
    def produce():
        return random.choice(producers)()
    return produce

base_producers = [produce_null, produce_int,
                  produce_float, produce_bool, produce_string]


def make_produce_array(element_producer):
    n = random.randint(2, 5)

    def produce():
        return '[' + ','.join([element_producer() for i in range(n)]) + ']'
    return produce


def make_produce_map(value_producer):
    def produce():
        return '{' + ','.join(['"%s": %s' % (random_word(), value_producer()) for i in range(20)]) + '}'
    return produce


def make_produce_union(element_producers):
    def produce():
        return '[' + ','.join([producer() for producer in element_producers]) + ']'
    return produce


def make_keys(n):
    keys = set()
    while len(keys) < n:
        keys.add(random_word())
    return list(keys)


def make_produce_random_class(n, element_producer):
    def produce():
        keys = make_keys(n)
        return '{' + ','.join(['"%s": %s' % (k, element_producer()) for k in keys]) + '}'
    return produce


def make_produce_class(value_producers):
    keys = make_keys(len(value_producers))

    def produce():
        return '{' + ','.join(['"%s": %s' % (k, producer()) for (k, producer) in zip(list(keys), value_producers)]) + '}'
    return produce


def make_all_union_producers(element_producers):
    def make_subsets(n, l):
        assert len(l) >= n
        if n == 0:
            return [[]]
        if len(l) == n:
            return [l]
        first = l[0]
        rest = l[1:]
        return [[first] + ss for ss in make_subsets(n - 1, rest)] + make_subsets(n, rest)
    subsets = []
    # for n in range(2, len(element_producers) + 1):
    for n in [2, 3]:
        subsets.extend(make_subsets(n, element_producers))
    return [make_produce_union(ps) for ps in subsets]


def run_producer(producer):
    print(producer())


def main():
    parser = argparse.ArgumentParser(
        description="Generate a large JSON document.")
    parser.add_argument('--array-size', nargs=1, type=int, default=[100000])
    parser.add_argument(
        '--array-type', choices=['int', 'array', 'object'], default='object')
    parser.add_argument('--array-elements', nargs=1, type=int, default=[3])
    parser.add_argument('--object-size', nargs=1, type=int, default=None)
    parser.add_argument('--class-count', nargs=1, type=int, default=None)
    parser.add_argument('--with-string-list', nargs=1, default=None)
    parser.add_argument('--combinations', action="store_true")
    parser.add_argument('--nested-objects', nargs=1, type=str, default=None)
    args = parser.parse_args()

    if args.combinations:
        base_array_producers = [make_produce_array(
            p) for p in base_producers + [make_produce_class(base_producers)]]
        base_map_producers = [make_produce_map(
            p) for p in base_producers]
        union_element_producers = base_producers + [make_produce_class(base_producers), make_produce_array(
            produce_null), make_produce_array(produce_int), make_produce_map(produce_null), make_produce_map(produce_int)]
        run_producer(make_produce_class(
            base_producers + base_array_producers + base_map_producers + [make_produce_class(base_producers)] + make_all_union_producers(union_element_producers)))
    elif args.nested_objects:
        counts = [int(x) for x in args.nested_objects[0].split(',')]
        producer = make_produce_random(base_producers)
        for count in reversed(counts):
            producer = make_produce_random_class(count, producer)
        run_producer(producer)
    elif args.with_string_list:
        with open(args.with_string_list[0]) as f:
            strings = [x[:-1] for x in f.readlines()]
        obj = {}
        for s in strings:
            obj[s] = s
        obj["dontMakeAMap"] = True
        json.dump(obj, sys.stdout)
    elif args.class_count:
        print('{')
        for i in range(args.class_count[0] - 1):
            print('  "class%d":' % i)
            print_object(args.object_size[0], '  ', ',')
        print('  "class%d":' % i)
        print_object(args.object_size[0], '  ', '')
        print('}')
    elif args.object_size:
        print_object(args.object_size[0], '', '')
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
                arr.extend([random_array_element() for _ in range(nelems - 1)])
            elem_format = '[%s]%%s' % ", ".join(arr)
            need_i = nelems > 0
        else:
            raise Exception("Unknown array type %s" % type)
        for i in range(n):
            semicolon = "," if i < n - 1 else ""
            if need_i:
                print(elem_format % (i, semicolon))
            else:
                print(elem_format % semicolon)
        print(']}')

if __name__ == "__main__":
    main()
