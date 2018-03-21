"use strict";

import * as fs from "fs";
import { Readable } from "stream";
import { getStream } from "../get-stream/index";

import { JSONSchemaStore, JSONSchema } from "../JSONSchemaStore";
import { panic } from "../Support";

// The typings for this module are screwy
const isURL = require("is-url");
const fetch = require("node-fetch");

export async function readableFromFileOrURL(fileOrUrl: string): Promise<Readable> {
    if (isURL(fileOrUrl)) {
        const response = await fetch(fileOrUrl);
        return response.body;
    } else if (fs.existsSync(fileOrUrl)) {
        return fs.createReadStream(fileOrUrl);
    } else {
        return panic(`Input file ${fileOrUrl} does not exist`);
    }
}

export async function readFromFileOrURL(fileOrURL: string): Promise<string> {
    return await getStream(await readableFromFileOrURL(fileOrURL));
}

export class FetchingJSONSchemaStore extends JSONSchemaStore {
    async fetch(address: string): Promise<JSONSchema | undefined> {
        // console.log(`Fetching ${address}`);
        return JSON.parse(await readFromFileOrURL(address));
    }
}
