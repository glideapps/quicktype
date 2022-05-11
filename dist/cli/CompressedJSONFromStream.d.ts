import { Readable } from "readable-stream";
import { CompressedJSON, Value } from "../quicktype-core/input/CompressedJSON";
export declare class CompressedJSONFromStream extends CompressedJSON<Readable> {
    parse(readStream: Readable): Promise<Value>;
    protected handleStartNumber: () => void;
    protected handleNumberChunk: (s: string) => void;
    protected handleEndNumber(): void;
    protected handleTrueValue(): void;
    protected handleFalseValue(): void;
}
