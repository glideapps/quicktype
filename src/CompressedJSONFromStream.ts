import { Readable } from "readable-stream";
import { CompressedJSON, Value } from "quicktype-core";
const { Parser } = require("stream-json");

const methodMap: { [name: string]: string } = {
    startObject: "pushObjectContext",
    endObject: "finishObject",
    startArray: "pushArrayContext",
    endArray: "finishArray",
    startNumber: "handleStartNumber",
    numberChunk: "handleNumberChunk",
    endNumber: "handleEndNumber",
    keyValue: "setPropertyKey",
    stringValue: "commitString",
    nullValue: "commitNull",
    trueValue: "handleTrueValue",
    falseValue: "handleFalseValue"
};

export class CompressedJSONFromStream extends CompressedJSON<Readable> {
    async parse(readStream: Readable): Promise<Value> {
        const combo = new Parser({ packKeys: true, packStrings: true });
        combo.on("data", (item: { name: string; value: string | undefined }) => {
            if (typeof methodMap[item.name] === "string") {
                (this as any)[methodMap[item.name]](item.value);
            }
        });
        const promise = new Promise<Value>((resolve, reject) => {
            combo.on("end", () => {
                resolve(this.finish());
            });
            combo.on("error", (err: any) => {
                reject(err);
            });
        });
        readStream.setEncoding("utf8");
        readStream.pipe(combo);
        readStream.resume();
        return promise;
    }

    protected handleStartNumber = (): void => {
        this.pushContext();
        this.context.currentNumberIsDouble = false;
    };

    protected handleNumberChunk = (s: string): void => {
        const ctx = this.context;
        if (!ctx.currentNumberIsDouble && /[\.e]/i.test(s)) {
            ctx.currentNumberIsDouble = true;
        }
    };

    protected handleEndNumber(): void {
        const isDouble = this.context.currentNumberIsDouble;
        this.popContext();
        this.commitNumber(isDouble);
    }

    protected handleTrueValue(): void {
        this.commitBoolean(true);
    }

    protected handleFalseValue(): void {
        this.commitBoolean(false);
    }
}
