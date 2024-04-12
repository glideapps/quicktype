import { type Readable } from "readable-stream";
import bufferStream from "./buffer-stream";

export interface Options {
    array?: boolean;
    encoding?: string;
    maxBuffer?: number;
}

export async function getStream(inputStream: Readable, opts: Options = {}) {
    if (!inputStream) {
        return await Promise.reject(new Error("Expected a stream"));
    }

    opts = Object.assign({ maxBuffer: Infinity }, opts);

    const maxBuffer = opts.maxBuffer ?? Infinity;
    let stream: any;
    let clean;

    const p = new Promise((resolve, reject) => {
        const error = (err: any) => {
            if (err) {
                // null check
                err.bufferedData = stream.getBufferedValue();
            }

            reject(err);
        };

        stream = bufferStream(opts);
        inputStream.once("error", error);
        inputStream.pipe(stream);

        stream.on("data", () => {
            if (stream.getBufferedLength() > maxBuffer) {
                reject(new Error("maxBuffer exceeded"));
            }
        });
        stream.once("error", error);
        stream.on("end", resolve);

        clean = () => {
            // some streams doesn't implement the `stream.Readable` interface correctly
            if (inputStream.unpipe) {
                inputStream.unpipe(stream);
            }
        };
    });

    p.then(clean, clean);

    return await p.then(() => stream.getBufferedValue());
}

export function buffer(stream: Readable, opts: Options = {}) {
    getStream(stream, Object.assign({}, opts, { encoding: "buffer" }));
}

export function array(stream: Readable, opts: Options = {}) {
    getStream(stream, Object.assign({}, opts, { array: true }));
}
