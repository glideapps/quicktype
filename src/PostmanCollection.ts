"use strict";

import { JSONTypeSource } from ".";

function isValidJSON(s: string): boolean {
    try {
        JSON.parse(s);
        return true;
    } catch (error) {
        return false;
    }
}

export function sourcesFromPostmanCollection(
    collectionJSON: string
): { sources: JSONTypeSource[]; description: string[] } {
    const sources: JSONTypeSource[] = [];
    const descriptions: string[] = [];

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
                const source: JSONTypeSource = { name: c.name, samples };
                if (typeof c.request === "object" && typeof c.request.description === "string") {
                    source.description = c.request.description;
                }
                sources.push(source);
            }
        }
    }

    processCollection(JSON.parse(collectionJSON));

    const joinedDescription = descriptions.join("\n\n").trim();
    let description: string[];
    if (joinedDescription === "") {
        description = [];
    } else {
        description = joinedDescription.split("\n");
    }

    return { sources, description };
}
