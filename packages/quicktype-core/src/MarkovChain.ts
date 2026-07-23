import { encodedMarkovChain } from "./EncodedMarkovChain.js";
import { assert, panic } from "./support/Support.js";

const alphabet =
    " -0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const alphabetSize = alphabet.length;
const base91Alphabet =
    "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}";
const unseenProbability = 0.0001;

const characterIndexes = new Int8Array(128).fill(-1);
for (let i = 0; i < alphabetSize; i++) {
    characterIndexes[alphabet.charCodeAt(i)] = i;
}

const base91Indexes = new Int8Array(128);
for (let i = 0; i < base91Alphabet.length; i++) {
    base91Indexes[base91Alphabet.charCodeAt(i)] = i;
}

// This must be null, not undefined, because we write it to JSON when training.
export type SubTrie = number | null | Trie;
export interface Trie {
    arr: SubTrie[];
    count: number;
}

export interface TrainingMarkovChain {
    depth: number;
    trie: Trie;
}

export interface MarkovChain {
    depth: 3;
    // Dense [first][second][third] indexes into probabilities.  Code zero is
    // the fixed unseen probability.
    probabilityCodes: Uint8Array;
    probabilities: Float32Array;
}

function decodeBase91(encoded: string): Uint8Array {
    const bytes = new Uint8Array(Math.ceil((encoded.length * 14) / 16));
    let output = 0;
    let value = -1;
    let bits = 0;
    let bitCount = 0;

    for (let i = 0; i < encoded.length; i++) {
        const digit = base91Indexes[encoded.charCodeAt(i)];
        if (value < 0) {
            value = digit;
            continue;
        }

        value += digit * 91;
        bits |= value << bitCount;
        bitCount += (value & 8191) > 88 ? 13 : 14;
        while (bitCount >= 8) {
            bytes[output++] = bits & 0xff;
            bits >>= 8;
            bitCount -= 8;
        }
        value = -1;
    }
    if (value >= 0) {
        bytes[output++] = (bits | (value << bitCount)) & 0xff;
    }
    return bytes.subarray(0, output);
}

class RansDecoder {
    private state: number;
    private position: number;

    public constructor(
        private readonly bytes: Uint8Array,
        offset: number,
        private readonly scale: number,
        private readonly symbolCount: number,
    ) {
        this.state = new DataView(
            bytes.buffer,
            bytes.byteOffset + offset,
            4,
        ).getUint32(0, true);
        this.position = offset + 4;
    }

    public read(
        model: number,
        frequencies: Uint16Array,
        cumulative: Uint16Array,
        symbols: Uint8Array,
    ): number {
        const slot = this.state % this.scale;
        const symbol = symbols[model * this.scale + slot];
        const index = model * this.symbolCount + symbol;
        this.state =
            frequencies[index] * Math.floor(this.state / this.scale) +
            slot -
            cumulative[index];
        while (this.state < 1 << 23) {
            this.state = this.state * 256 + this.bytes[this.position++];
        }
        return symbol;
    }
}

function makeEntropyTables(
    frequencies: Uint16Array,
    modelCount: number,
    symbolCount: number,
    scale: number,
): { cumulative: Uint16Array; symbols: Uint8Array } {
    const cumulative = new Uint16Array(frequencies.length);
    const symbols = new Uint8Array(modelCount * scale);
    for (let model = 0; model < modelCount; model++) {
        let sum = 0;
        for (let symbol = 0; symbol < symbolCount; symbol++) {
            const index = model * symbolCount + symbol;
            cumulative[index] = sum;
            symbols.fill(
                symbol,
                model * scale + sum,
                model * scale + sum + frequencies[index],
            );
            sum += frequencies[index];
        }
    }
    return { cumulative, symbols };
}

function decode(encoded: string): MarkovChain {
    const bytes = decodeBase91(encoded);
    const levelCount = bytes[0];
    const modelCount = bytes[1];
    const scale = 1 << bytes[2];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 4;
    const probabilities = new Float32Array(levelCount + 1);
    probabilities[0] = unseenProbability;
    for (let level = 1; level <= levelCount; level++) {
        probabilities[level] = view.getFloat32(offset, true);
        offset += 4;
    }

    const dataFrequencies = new Uint16Array(modelCount * (levelCount + 1));
    for (let model = 0; model < modelCount; model++) {
        let sum = 0;
        for (let symbol = 0; symbol < levelCount; symbol++) {
            const frequency = view.getUint16(offset, true);
            offset += 2;
            dataFrequencies[model * (levelCount + 1) + symbol] = frequency;
            sum += frequency;
        }
        dataFrequencies[model * (levelCount + 1) + levelCount] = scale - sum;
    }

    const modelFrequencies = new Uint16Array(modelCount);
    let modelFrequencySum = 0;
    for (let model = 0; model < modelCount - 1; model++) {
        const frequency = view.getUint16(offset, true);
        offset += 2;
        modelFrequencies[model] = frequency;
        modelFrequencySum += frequency;
    }
    modelFrequencies[modelCount - 1] = scale - modelFrequencySum;
    const modelStreamLength = view.getUint32(offset, true);
    offset += 4;

    const modelTables = makeEntropyTables(
        modelFrequencies,
        1,
        modelCount,
        scale,
    );
    const modelDecoder = new RansDecoder(bytes, offset, scale, modelCount);
    const columnModels = new Uint8Array(alphabetSize ** 2);
    for (let column = 0; column < columnModels.length; column++) {
        columnModels[column] = modelDecoder.read(
            0,
            modelFrequencies,
            modelTables.cumulative,
            modelTables.symbols,
        );
    }

    const dataTables = makeEntropyTables(
        dataFrequencies,
        modelCount,
        levelCount + 1,
        scale,
    );
    const dataDecoder = new RansDecoder(
        bytes,
        offset + modelStreamLength,
        scale,
        levelCount + 1,
    );
    const probabilityCodes = new Uint8Array(alphabetSize ** 3);
    for (let second = 0; second < alphabetSize; second++) {
        for (let character = 0; character < alphabetSize; character++) {
            const model = columnModels[second * alphabetSize + character];
            for (let first = 0; first < alphabetSize; first++) {
                probabilityCodes[
                    (first * alphabetSize + second) * alphabetSize + character
                ] = dataDecoder.read(
                    model,
                    dataFrequencies,
                    dataTables.cumulative,
                    dataTables.symbols,
                );
            }
        }
    }

    return { depth: 3, probabilityCodes, probabilities };
}

function characterIndex(word: string, index: number): number {
    const code = word.charCodeAt(index);
    return code < 128 ? characterIndexes[code] : -1;
}

function makeTrie(): Trie {
    const arr: SubTrie[] = [];
    for (let i = 0; i < 128; i++) arr.push(null);
    return { count: 0, arr };
}

function increment(t: Trie, seq: string, i: number): void {
    let first = seq.charCodeAt(i);
    if (first >= 128) first = 0;

    if (i >= seq.length - 1) {
        let n = t.arr[first];
        if (n === null) {
            n = 0;
        } else if (typeof n === "object") {
            return panic("Malformed trie");
        }
        t.arr[first] = n + 1;
        t.count += 1;
        return;
    }

    let st = t.arr[first];
    if (st === null) {
        st = makeTrie();
        t.arr[first] = st;
    }
    if (typeof st !== "object") return panic("Malformed trie");
    increment(st, seq, i + 1);
}

export function train(lines: string[], depth: number): TrainingMarkovChain {
    const trie = makeTrie();
    for (const line of lines) {
        for (let i = depth; i <= line.length; i++) {
            increment(trie, line.slice(i - depth, i), 0);
        }
    }
    return { trie, depth };
}

export function load(): MarkovChain {
    return decode(encodedMarkovChain);
}

export function evaluateFull(
    mc: MarkovChain,
    word: string,
): [number, number[]] {
    if (word.length < mc.depth) return [1, []];

    const { probabilityCodes, probabilities } = mc;
    let first = characterIndexes[word.charCodeAt(0)];
    let second = characterIndexes[word.charCodeAt(1)];
    let probability = 1;
    const scores: number[] = [];

    for (let i = 2; i < word.length; i++) {
        const third = characterIndexes[word.charCodeAt(i)];
        let score = unseenProbability;
        if (first >= 0 && second >= 0 && third >= 0) {
            const prefix = first * alphabetSize + second;
            const code = probabilityCodes[prefix * alphabetSize + third];
            if (code !== 0) {
                score = probabilities[code];
            }
        }
        scores.push(score);
        probability *= score;
        first = second;
        second = third;
    }

    return [probability ** (1 / scores.length), scores];
}

export function evaluate(mc: MarkovChain, word: string): number {
    if (word.length < mc.depth) return 1;

    const { probabilityCodes, probabilities } = mc;
    let first = characterIndexes[word.charCodeAt(0)];
    let second = characterIndexes[word.charCodeAt(1)];
    let probability = 1;

    for (let i = 2; i < word.length; i++) {
        const third = characterIndexes[word.charCodeAt(i)];
        let score = unseenProbability;
        if (first >= 0 && second >= 0 && third >= 0) {
            const prefix = first * alphabetSize + second;
            const code = probabilityCodes[prefix * alphabetSize + third];
            if (code !== 0) {
                score = probabilities[code];
            }
        }
        probability *= score;
        first = second;
        second = third;
    }

    return probability ** (1 / (word.length - 2));
}

function randomInt(lower: number, upper: number): number {
    return lower + Math.floor(Math.random() * (upper - lower));
}

export function generate(
    mc: MarkovChain,
    state: string,
    unseenWeight: number,
): string {
    assert(
        state.length === mc.depth - 1,
        "State and chain length don't match up",
    );

    const first = characterIndex(state, 0);
    const second = characterIndex(state, 1);
    if (first < 0 || second < 0) {
        return String.fromCharCode(randomInt(32, 127));
    }
    const weights = new Array<number>(128);
    const prefix = first * alphabetSize + second;
    let total = 0;
    for (let code = 0; code < 128; code++) {
        const index = characterIndexes[code];
        const probabilityCode =
            index < 0 ? 0 : mc.probabilityCodes[prefix * alphabetSize + index];
        const weight =
            probabilityCode === 0
                ? code === 0
                    ? 0
                    : unseenWeight
                : mc.probabilities[probabilityCode] * 1_000_000;
        weights[code] = weight;
        total += weight;
    }

    const choice = randomInt(0, total);
    let sum = 0;
    for (let code = 0; code < weights.length; code++) {
        sum += weights[code];
        if (choice < sum) return String.fromCharCode(code);
    }
    return panic("We screwed up bookkeeping, or randomInt");
}
