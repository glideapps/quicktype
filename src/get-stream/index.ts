"use strict";
const bufferStream = require("./buffer-stream");

export function getStream(inputStream: any, opts: any = {}) {
    if (!inputStream) {
        return Promise.reject(new Error("Expected a stream"));
    }

    opts = Object.assign({ maxBuffer: Infinity }, opts);

    const maxBuffer = opts.maxBuffer;
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

    return p.then(() => stream.getBufferedValue());
}

module.exports = getStream;
module.exports.buffer = (stream: any, opts: any) => getStream(stream, Object.assign({}, opts, { encoding: "buffer" }));
module.exports.array = (stream: any, opts: any) => getStream(stream, Object.assign({}, opts, { array: true }));
