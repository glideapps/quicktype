import type { Readable } from "readable-stream";
import { parser } from "stream-json";
import type { Token } from "stream-json/core/parser.js";

import { CompressedJSON, type Value } from "quicktype-core";

export class CompressedJSONFromStream extends CompressedJSON<Readable> {
    public async parse(readStream: Readable): Promise<Value> {
        const combo = parser.asStream({ packKeys: true, packStrings: true });
        combo.on("data", (item: Token) => {
            this.processToken(item);
        });
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
}
