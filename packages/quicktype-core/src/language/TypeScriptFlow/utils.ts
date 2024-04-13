import { isES3IdentifierStart } from "../JavaScript/unicodeMaps";
import { legalizeName } from "../JavaScript/utils";
import { utf16StringEscape } from "../../support/Strings";

export const tsFlowTypeAnnotations = {
    any: ": any",
    anyArray: ": any[]",
    anyMap: ": { [k: string]: any }",
    string: ": string",
    stringArray: ": string[]",
    boolean: ": boolean"
};

export function quotePropertyName(original: string): string {
    const escaped = utf16StringEscape(original);
    const quoted = `"${escaped}"`;

    if (original.length === 0) {
        return quoted;
    } else if (!isES3IdentifierStart(original.codePointAt(0) as number)) {
        return quoted;
    } else if (escaped !== original) {
        return quoted;
    } else if (legalizeName(original) !== original) {
        return quoted;
    } else {
        return original;
    }
}
