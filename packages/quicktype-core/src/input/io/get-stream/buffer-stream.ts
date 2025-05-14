/* eslint-disable @typescript-eslint/no-explicit-any */
import { PassThrough } from "readable-stream";

import { type Options } from "./index";

export interface BufferedPassThrough extends PassThrough {
	getBufferedValue: () => any;
	getBufferedLength: () => number;

	// for compat with _Readable.Writable
	readonly writableObjectMode: never;
}

export default function bufferStream(opts: Options) {
    opts = Object.assign({}, opts);

    const array = opts.array;
    let encoding: string | undefined = opts.encoding;
    const buffer = encoding === "buffer";
    let objectMode = false;

    if (array) {
        objectMode = !(encoding || buffer);
    } else {
        encoding = encoding || "utf8";
    }

    if (buffer) {
        encoding = undefined;
    }

    let len = 0;
    const ret: any[] = [];
    const stream = new PassThrough({
        objectMode
    }) as BufferedPassThrough;

    if (encoding) {
        stream.setEncoding(encoding as BufferEncoding);
    }

    stream.on("data", (chunk: any) => {
        ret.push(chunk);

        if (objectMode) {
            len = ret.length;
        } else {
            len += chunk.length;
        }
    });

    stream.getBufferedValue = () => {
        if (array) {
            return ret;
        }

        return buffer ? Buffer.concat(ret, len) : ret.join("");
    };

    stream.getBufferedLength = () => len;

    return stream;
}
