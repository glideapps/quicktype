import { parseJSON } from "../support/Support";

import { type JSONSourceData } from "./Inputs";

function isValidJSON(s: string): boolean {
    try {
        JSON.parse(s);
        return true;
    } catch (error) {
        return false;
    }
}

export function sourcesFromPostmanCollection(
    collectionJSON: string,
    collectionJSONAddress?: string
): { description: string | undefined; sources: Array<JSONSourceData<string>> } {
    const sources: Array<JSONSourceData<string>> = [];
    const descriptions: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function processCollection(c: any): void {
        if (typeof c !== "object") return;
        if (Array.isArray(c.item)) {
            for (const item of c.item) {
                processCollection(item);
            }

            if (typeof c.info === "object" && typeof c.info.description === "string") {
                descriptions.push(c.info.description);
            }
        }

        if (typeof c.name === "string" && Array.isArray(c.response)) {
            const samples: string[] = [];
            for (const r of c.response) {
                if (typeof r === "object" && typeof r.body === "string" && isValidJSON(r.body)) {
                    samples.push(r.body);
                }
            }

            if (samples.length > 0) {
                const source: JSONSourceData<string> = { name: c.name, samples };
                const sourceDescription = [c.name];

                if (typeof c.request === "object") {
                    const { method, url } = c.request;
                    if (method !== undefined && typeof url === "object" && url.raw !== undefined) {
                        sourceDescription.push(`${method} ${url.raw}`);
                    }
                }

                if (typeof c.request === "object" && typeof c.request.description === "string") {
                    sourceDescription.push(c.request.description);
                }

                source.description = sourceDescription.length === 0 ? undefined : sourceDescription.join("\n\n");
                sources.push(source);
            }
        }
    }

    processCollection(parseJSON(collectionJSON, "Postman collection", collectionJSONAddress));

    const joinedDescription = descriptions.join("\n\n").trim();
    let description: string | undefined = undefined;
    if (joinedDescription !== "") {
        description = joinedDescription;
    }

    return { sources, description };
}
