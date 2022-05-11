export declare type SubTrie = number | null | Trie;
export declare type Trie = {
    count: number;
    arr: SubTrie[];
};
export declare type MarkovChain = {
    trie: Trie;
    depth: number;
};
export declare function train(lines: string[], depth: number): MarkovChain;
export declare function load(): MarkovChain;
export declare function evaluateFull(mc: MarkovChain, word: string): [number, number[]];
export declare function evaluate(mc: MarkovChain, word: string): number;
export declare function generate(mc: MarkovChain, state: string, unseenWeight: number): string;
export declare function test(): void;
