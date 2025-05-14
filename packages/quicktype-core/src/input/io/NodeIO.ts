import * as fs from "fs";

import { defined, exceptionToString } from "@glideapps/ts-necessities";
import { isNode } from "browser-or-node";
import isURL from "is-url";
import { type Readable } from "readable-stream";

import { messageError } from "../../Messages";
import { panic } from "../../support/Support";

import { getStream } from "./get-stream";

// We need to use cross-fetch in CI or if fetch is not available in the global scope
// We use a dynamic import to avoid punycode deprecated dependency warning on node > 20
const fetch = process.env.CI
    ? require("cross-fetch").default
    : ((global as any).fetch ?? require("cross-fetch").default);

interface HttpHeaders {
    [key: string]: string;
}

function parseHeaders(httpHeaders?: string[]): HttpHeaders {
    if (!Array.isArray(httpHeaders)) {
        return {};
    }

    return httpHeaders.reduce(function (
        result: HttpHeaders,
        httpHeader: string,
    ) {
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
    }, {} as HttpHeaders);
}

export async function readableFromFileOrURL(
    fileOrURL: string,
    httpHeaders?: string[],
): Promise<Readable> {
    try {
        if (isURL(fileOrURL)) {
            const response = await fetch(fileOrURL, {
                headers: parseHeaders(httpHeaders),
            });

            return defined(response.body) as unknown as Readable;
        } else if (isNode) {
            if (fileOrURL === "-") {
                // Cast node readable to isomorphic readable from readable-stream
                return process.stdin as unknown as Readable;
            }

            const filePath = fs.lstatSync(fileOrURL).isSymbolicLink()
                ? fs.readlinkSync(fileOrURL)
                : fileOrURL;
            if (fs.existsSync(filePath)) {
                // Cast node readable to isomorphic readable from readable-stream
                return fs.createReadStream(
                    filePath,
                    "utf8",
                ) as unknown as Readable;
            }
        }
    } catch (e) {
        return messageError("MiscReadError", {
            fileOrURL,
            message: exceptionToString(e),
        });
    }

    return messageError("DriverInputFileDoesNotExist", { filename: fileOrURL });
}

export async function readFromFileOrURL(
    fileOrURL: string,
    httpHeaders?: string[],
): Promise<string> {
    const readable = await readableFromFileOrURL(fileOrURL, httpHeaders);
    try {
        return await getStream(readable);
    } catch (e) {
        return messageError("MiscReadError", {
            fileOrURL,
            message: exceptionToString(e),
        });
    }
}
