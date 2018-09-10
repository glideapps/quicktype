import * as fs from "fs";
import { Readable } from "stream";
import { messageError, getStream, JSONSchemaStore, JSONSchema, parseJSON } from "../quicktype-core";

// The typings for this module are screwy
const isURL = require("is-url");
const fetch = require("node-fetch");

export async function readableFromFileOrURL(fileOrURL: string): Promise<Readable> {
    try {
        if (fileOrURL === "-") {
            return process.stdin;
        } else if (isURL(fileOrURL)) {
            const response = await fetch(fileOrURL);
            return response.body;
        } else if (fs.existsSync(fileOrURL)) {
            return fs.createReadStream(fileOrURL, "utf8");
        }
    } catch (e) {
        const message = typeof e.message === "string" ? e.message : "Unknown error";
        return messageError("MiscReadError", { fileOrURL, message });
    }
    return messageError("DriverInputFileDoesNotExist", { filename: fileOrURL });
}

export async function readFromFileOrURL(fileOrURL: string): Promise<string> {
    const readable = await readableFromFileOrURL(fileOrURL);
    try {
        return await getStream(readable);
    } catch (e) {
        const message = typeof e.message === "string" ? e.message : "Unknown error";
        return messageError("MiscReadError", { fileOrURL, message });
    }
}

export class FetchingJSONSchemaStore extends JSONSchemaStore {
    async fetch(address: string): Promise<JSONSchema | undefined> {
        // console.log(`Fetching ${address}`);
        return parseJSON(await readFromFileOrURL(address), "JSON Schema", address);
    }
}
