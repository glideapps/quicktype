import { PassThrough } from "readable-stream";

import { type Options } from ".";

export default function bufferStream(opts: Options) {
    opts = Object.assign({}, opts);

    const array = opts.array;
    let encoding: string | undefined = opts.encoding;
    const buffer = encoding === "buffer";
    let objectMode = false;

    if (array) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        objectMode = !(encoding || buffer);
    } else {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        encoding = encoding || "utf8";
    }

    if (buffer) {
        encoding = undefined;
    }

    let len = 0;
    const ret: any[] = [];
    const stream = new PassThrough({
        objectMode
    }) as any;

    if (encoding) {
        stream.setEncoding(encoding);
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
