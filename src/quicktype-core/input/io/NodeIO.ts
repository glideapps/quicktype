import * as fs from "fs";
import {Readable} from "readable-stream";
import {isNode} from "browser-or-node";
import {getStream} from "./get-stream";

import {messageError, panic} from "../../index";

// The typings for this module are screwy
const isURL = require("is-url");
const fetch = require("isomorphic-fetch");

interface HttpHeaders {
    [key: string]: string;
}

function parseHeaders(httpHeaders?: string[]): HttpHeaders {
    if (!Array.isArray(httpHeaders)) {
        return {};
    }

    return httpHeaders.reduce(
        function(result: HttpHeaders, httpHeader: string) {
            if (httpHeader !== undefined && httpHeader.length > 0) {
                const split = httpHeader.indexOf(":");

                if (split < 0) {
                    return panic(`Could not parse HTTP header "${httpHeader}".`);
                }

                const key = httpHeader.slice(0, split).trim();
                const value = httpHeader.slice(split + 1).trim();
                result[key] = value;
            }

            return result;
        },
        {} as HttpHeaders
    );
}

export async function readableFromFileOrURL(fileOrURL: string, httpHeaders?: string[]): Promise<Readable> {
    try {
        if (isURL(fileOrURL)) {
            const response = await fetch(fileOrURL, {
                headers: parseHeaders(httpHeaders)
            });
            return response.body;
        } else if (isNode) {
            if (fileOrURL === "-") {
            // Cast node readable to isomorphic readable from readable-stream
                return process.stdin as unknown as Readable;
            }
            const filePath = fs.lstatSync(fileOrURL).isSymbolicLink() ? fs.readlinkSync(fileOrURL) : fileOrURL;
            if (fs.existsSync(filePath)) {
                // Cast node readable to isomorphic readable from readable-stream
                return fs.createReadStream(filePath, "utf8") as unknown as Readable;
            }
        }
    } catch (e) {
        const message = typeof e.message === "string" ? e.message : "Unknown error";
        return messageError("MiscReadError", { fileOrURL, message });
    }
    return messageError("DriverInputFileDoesNotExist", { filename: fileOrURL });
}

export async function readFromFileOrURL(fileOrURL: string, httpHeaders?: string[]): Promise<string> {
    const readable = await readableFromFileOrURL(fileOrURL, httpHeaders);
    try {
        return await getStream(readable);
    } catch (e) {
        const message = typeof e.message === "string" ? e.message : "Unknown error";
        return messageError("MiscReadError", { fileOrURL, message });
    }
}
