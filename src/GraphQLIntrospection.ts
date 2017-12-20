"use strict";

import { panic } from "./Support";
import { introspectionQuery } from "graphql";

const fetch = require("node-fetch");

// https://github.com/apollographql/apollo-codegen/blob/master/src/downloadSchema.ts
const defaultHeaders: { [name: string]: string } = {
    Accept: "application/json",
    "Content-Type": "application/json"
};

const headerRegExp = /^([^:]+):\s*(.*)$/;

export async function introspectServer(url: string, headerStrings: string[]): Promise<string> {
    const headers: { [name: string]: string } = {};

    console.log(`given headers: ${JSON.stringify(headerStrings)}`);
    for (const name of Object.getOwnPropertyNames(defaultHeaders)) {
        headers[name] = defaultHeaders[name];
    }
    for (const str of headerStrings) {
        const matches = str.match(headerRegExp);
        if (matches === null) {
            return panic(`Not a valid HTTP header: "${str}"`);
        }
        headers[matches[1]] = matches[2];
    }

    console.log(`headers are ${JSON.stringify(headers)}`);
    let result;
    try {
        const response = await fetch(url, {
            headers: headers,
            body: JSON.stringify({ query: introspectionQuery })
        });

        result = await response.json();
    } catch (error) {
        return panic(`Error while fetching introspection query result: ${error.message}`);
    }

    if (result.errors) {
        return panic(`Errors in introspection query result: ${result.errors}`);
    }

    const schemaData = result;
    if (!schemaData.data) {
        return panic(`No introspection query result data found, server responded with: ${JSON.stringify(result)}`);
    }

    return JSON.stringify(schemaData, null, 2);
}
