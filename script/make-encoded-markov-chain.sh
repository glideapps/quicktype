#!/bin/bash

./generate-markov-corpus.py >/tmp/corpus.txt
../script/quickertype --build-markov-chain /tmp/corpus.txt >/tmp/markov.json
node ../script/encode-markov-chain.mjs /tmp/markov.json \
    ../packages/quicktype-core/src/EncodedMarkovChain.ts
