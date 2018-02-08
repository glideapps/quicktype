#!/bin/bash

./generate-markov-corpus.py >/tmp/corpus.txt
../script/quickertype --build-markov-chain /tmp/corpus.txt >/tmp/markov.json
gzip -9 /tmp/markov.json
echo -n 'export const encodedMarkovChain = "'
base64 /tmp/markov.json.gz | tr -d '\n'
echo '";'
