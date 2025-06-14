import { exceptionToString } from "@glideapps/ts-necessities";
import fetch from "cross-fetch";
import { getIntrospectionQuery } from "graphql";

import { panic } from "quicktype-core";

// https://github.com/apollographql/apollo-codegen/blob/master/src/downloadSchema.ts
const defaultHeaders: { [name: string]: string } = {
    Accept: "application/json",
    "Content-Type": "application/json",
};

const headerRegExp = /^([^:]+):\s*(.*)$/;

export async function introspectServer(
    url: string,
    method: string,
    headerStrings: string[],
): Promise<string> {
    const headers: { [name: string]: string } = {};

    for (const name of Object.getOwnPropertyNames(defaultHeaders)) {
        headers[name] = defaultHeaders[name];
    }

    for (const str of headerStrings) {
        const matches = headerRegExp.exec(str);
        if (matches === null) {
            return panic(`Not a valid HTTP header: "${str}"`);
        }

        headers[matches[1]] = matches[2];
    }

    let result;
    try {
        const response = await fetch(url, {
            method,
            headers: headers,
            body: JSON.stringify({ query: getIntrospectionQuery() }),
        });

        result = await response.json();
    } catch (error) {
        return panic(
            `Error while fetching introspection query result: ${exceptionToString(error)}`,
        );
    }

    if (result.errors) {
        return panic(
            `Errors in introspection query result: ${JSON.stringify(result.errors)}`,
        );
    }

    const schemaData = result;
    if (!schemaData.data) {
        return panic(
            `No introspection query result data found, server responded with: ${JSON.stringify(result)}`,
        );
    }

    return JSON.stringify(schemaData, null, 2);
}
