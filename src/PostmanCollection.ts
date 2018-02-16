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

export function sourcesFromPostmanCollection(collectionJSON: string): JSONTypeSource[] {
    const sources: JSONTypeSource[] = [];

    function processCollection(c: any): void {
        if (typeof c !== "object") return;
        if (Array.isArray(c.item)) {
            for (const item of c.item) {
                processCollection(item);
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
                sources.push({ name: c.name, samples });
            }
        }
    }

    processCollection(JSON.parse(collectionJSON));
    console.log("sources are", JSON.stringify(sources));
    return sources;
}
