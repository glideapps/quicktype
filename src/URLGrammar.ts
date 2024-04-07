import { panic, checkStringMap, checkArray } from "quicktype-core";

function expand (json: any): string[] {
    if (typeof json === "string") {
        return [json];
    }

    if (Array.isArray(json)) {
        let result: string[] = [""];
        for (const j of json) {
            const expanded = expand(j);
            const appended: string[] = [];
            for (const a of result) {
                for (const b of expanded) {
                    appended.push(a + b);
                }
            }

            result = appended;
        }

        return result;
    }

    if (Object.prototype.hasOwnProperty.call(json, "oneOf")) {
        const options = checkArray(json.oneOf);
        const result: string[] = [];
        for (const j of options) {
            for (const x of expand(j)) {
                result.push(x);
            }
        }

        return result;
    }

    return panic(`Value is not a valid URL grammar: ${json}`);
}

export function urlsFromURLGrammar (json: any): { [name: string]: string[], } {
    const topLevelMap = checkStringMap(json);
    const results: { [name: string]: string[], } = {};

    for (const name of Object.getOwnPropertyNames(topLevelMap)) {
        results[name] = expand(topLevelMap[name]);
    }

    return results;
}
