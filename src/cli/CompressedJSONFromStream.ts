import { Readable } from "readable-stream";
import { parse as JSON5parse } from "json5";
import { CompressedJSON, Value } from "../quicktype-core/input/CompressedJSON";
import { panic } from "../quicktype-core/support/Support";
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
export class CompressedJSON5FromStream extends CompressedJSON<Readable> {
    async parse(readStream: Readable): Promise<Value> {
        let json5 = "";
        readStream.on("data", data => {
            json5 += data;
        });
        const promise = new Promise<Value>((resolve, reject) => {
            readStream.on("end", () => {
                this.process(JSON5parse(json5));
                resolve(this.finish());
            });
            readStream.on("error", err => {
                reject(err);
            });
        });
        readStream.setEncoding("utf8");
        readStream.resume();
        return promise;
    }

    private process(json: unknown): void {
        if (json === null) {
            this.commitNull();
        } else if (typeof json === "boolean") {
            this.commitBoolean(json);
        } else if (typeof json === "string") {
            this.commitString(json);
        } else if (typeof json === "number") {
            const isDouble =
                json !== Math.floor(json) || json < Number.MIN_SAFE_INTEGER || json > Number.MAX_SAFE_INTEGER;
            this.commitNumber(isDouble);
        } else if (Array.isArray(json)) {
            this.pushArrayContext();
            for (const v of json) {
                this.process(v);
            }
            this.finishArray();
        } else if (typeof json === "object") {
            this.pushObjectContext();
            for (const key of Object.getOwnPropertyNames(json)) {
                this.setPropertyKey(key);
                this.process((json as any)[key]);
            }
            this.finishObject();
        } else {
            return panic("Invalid JSON object");
        }
    }
}
