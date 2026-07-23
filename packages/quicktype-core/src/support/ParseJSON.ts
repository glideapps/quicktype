import * as YAML from "yaml";

import type { JSONSchema } from "../input/JSONSchemaStore.js";
import { messageError } from "../Messages.js";

export function parseJSON(
    text: string,
    description: string,
    address = "<unknown>",
): JSONSchema | undefined {
    try {
        // https://gist.github.com/pbakondy/f5045eff725193dad9c7
        if (text.charCodeAt(0) === 0xfeff) {
            text = text.slice(1);
        }

        try {
            return JSON.parse(text);
        } catch {
            return YAML.parse(text);
        }
    } catch (e) {
        let message: string;

        if (e instanceof SyntaxError) {
            message = e.message;
        } else {
            message = `Unknown exception ${e}`;
        }

        return messageError("MiscJSONParseError", {
            description,
            address,
            message,
        });
    }
}
