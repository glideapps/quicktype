import { readFileSync } from "fs";
import { InputData, JSONSchemaInput, quicktype } from "../../../quicktype-core";
import { resolve } from "path";

const setupAndRunConvert = async (file: string) => {
    const schema = readFileSync(resolve(file), "utf8");
    const schemaInput = new JSONSchemaInput(undefined, []);
    await schemaInput.addSource({ name: "Test", schema});

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    return (await quicktype({
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
    })).lines.join("\n");
};
describe("jsonSchema to ts", () => {

    it("should convert with additionalProperties and specific type", async () => {
        const output = await setupAndRunConvert(`${__dirname}/../../../../test/inputs/schema/class-with-additional.schema`);

        expect(output).toBe(`export interface Test {
    map?: Map;
}

export interface Map {
    foo?: number;
    [k: string]: bool;
}
`);
    });

    it("should convert with additionalProperties and any type", async () => {
        const output = await setupAndRunConvert(`${__dirname}/../../../../test/inputs/schema/intersection.schema`);

        expect(output).toBe(`export interface Test {
    intersection?: Intersection;
}

export interface Intersection {
    bar?: string;
    foo:  number;
    [k: string]: any;
}
`);
    });
});
