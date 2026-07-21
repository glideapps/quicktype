import type { Readable } from "readable-stream";
import { parser } from "stream-json";

import { CompressedJSON, type Value } from "quicktype-core";

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
    falseValue: "handleFalseValue",
};

export class CompressedJSONFromStream extends CompressedJSON<Readable> {
    // The text of the integer literal being parsed.  Numbers cannot nest,
    // so a single accumulator suffices.  Only consulted when the number is
    // not already classified as a double.
    private _currentIntegerString = "";

    public async parse(readStream: Readable): Promise<Value> {
        const combo = parser.asStream({ packKeys: true, packStrings: true });
        combo.on(
            "data",
            (item: { name: string; value: string | undefined }) => {
                if (typeof methodMap[item.name] === "string") {
                    // @ts-expect-error FIXME: strongly type this
                    this[methodMap[item.name]](item.value);
                }
            },
        );
        const promise = new Promise<Value>((resolve, reject) => {
            combo.on("end", () => {
                resolve(this.finish());
            });
            combo.on("error", (err: unknown) => {
                reject(err);
            });
        });
        readStream.setEncoding("utf8");
        readStream.pipe(combo);
        readStream.resume();
        return await promise;
    }

    protected handleStartNumber = (): void => {
        this.pushContext();
        this.context.currentNumberIsDouble = false;
        this._currentIntegerString = "";
    };

    protected handleNumberChunk = (s: string): void => {
        const ctx = this.context;
        if (ctx.currentNumberIsDouble) return;

        if (/[.e]/i.test(s)) {
            ctx.currentNumberIsDouble = true;
        } else {
            this._currentIntegerString += s;
        }
    };

    protected handleEndNumber(): void {
        // A whole number outside the target language's integer range must
        // be a double — the integer type could not round-trip it
        // (https://github.com/glideapps/quicktype/issues/2931).
        const isDouble =
            this.context.currentNumberIsDouble ||
            !this.integerStringFits(this._currentIntegerString);
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
