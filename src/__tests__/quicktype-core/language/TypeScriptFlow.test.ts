import { readFileSync } from "fs";
import { InputData, JSONSchemaInput, quicktype } from "../../../quicktype-core";
import { resolve } from "path";

describe("json to ts", () => {
    it("should convert with additionalProperties", async () => {
        const schema = readFileSync(resolve(`${__dirname}/../../../../test/inputs/schema/class-with-additional.schema`), "utf8");
        const schemaInput = new JSONSchemaInput(undefined, []);
        await schemaInput.addSource({ name: "Test", schema});

        const inputData = new InputData();
        inputData.addInput(schemaInput);

        const result = await quicktype({
            inputData,
            lang: "typescript",
            checkProvenance: false,
            inferDateTimes: true,
            inferBooleanStrings: true,
            inferIntegerStrings: true,
            inferMaps: true,
            inferUuids: true,
            alphabetizeProperties: true,
            inferEnums: true,
            rendererOptions: {
                "just-types": "true",
                "runtime-check": "true",
            },
        });

        expect(result.lines.join("\n")).toBe(`export interface Test {
    map?: Map;
}

export interface Map {
    foo?: number;
    [k: string]: bool;
}
`);
    });
});
