#!/usr/bin/env python

import random

with open('/usr/share/dict/words') as f:
    words = f.read().splitlines()

with open('acronyms.txt') as f:
    acronyms = f.read().splitlines()

def all_lower(w):
    [word, _] = w
    return word.lower()

def all_upper(w):
    [word, _] = w
    return word.upper()

def capitalize(w):
    [word, _] = w
    return word[:1].upper() + word[1:].lower()

def cap_and_upper_acro(w):
    [word, is_acro] = w
    if is_acro:
        return all_upper(w)
    else:
        return capitalize(w)

def choice(items):
    total = sum([n for [n, _] in items])
    x = random.random()
    s = 0
    for [n, item] in items:
        s += n
        if x <= s / total:
            return item
    raise Exception()

formats = [
    [3, [all_lower, all_lower, "_"]],
    [1, [all_upper, all_upper, "-"]],
    [1, [all_lower, all_lower, " "]],
    [5, [all_lower, capitalize, ""]],
    [5, [all_lower, cap_and_upper_acro, ""]],
    [3, [cap_and_upper_acro, cap_and_upper_acro, ""]]
]

prefixes = [
    [10, ""],
    [1, "_"]
]

def word():
    return [[random.choice(words), False]]

def word_word():
    return [[random.choice(words), False], [random.choice(words), False]]

def word_acronym():
    return [[random.choice(words), False], [random.choice(acronyms), True]]

def acronym_word():
    return [[random.choice(acronyms), True], [random.choice(words), False]]

def word_digit():
    return [[random.choice(words), False], [str(random.randint(1, random.randint(1, 200))), False]]

def word_acronym_digit():
    return [[random.choice(words), False], [random.choice(acronyms), True], [str(random.randint(1, 9)), False]]

generators = [
    [1, word],
    [2, word_word],
    [2, word_acronym],
    [2, acronym_word],
    [2, word_digit],
    [2, word_acronym_digit]
]

def make_corpus_entry():
    words = choice(generators)()
    [first_format, rest_format, separator] = choice(formats)
    formatted = [first_format(words[0])] + [rest_format(w) for w in words[1:]]
    return choice(prefixes) + separator.join(formatted)

for i in range(1000000):
    print(make_corpus_entry())
