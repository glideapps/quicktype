import * as fs from "node:fs";
import * as path from "node:path";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { schemaForTypeScriptSources } from "quicktype-typescript-input";
import { afterAll, describe, expect, test } from "vitest";

// schemaForTypeScriptSources compiles with `rootDir: "."`, so the input files
// must live under the current working directory (the repository root when
// vitest runs). Use a temp directory inside the repository and pass paths
// relative to the working directory.
const temporaryDirectory = fs.mkdtempSync(
    path.join(process.cwd(), ".tmp-typescript-input-test-"),
);

afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

let uniqueFileIndex = 0;

function schemaSourceForSource(source: string) {
    const fileName = path.join(
        path.relative(process.cwd(), temporaryDirectory),
        `input-${uniqueFileIndex++}.ts`,
    );
    fs.writeFileSync(fileName, source);
    return schemaForTypeScriptSources([fileName]);
}

function schemaForSource(source: string) {
    const result = schemaSourceForSource(source);
    return {
        name: result.name ?? "",
        schema: JSON.parse(result.schema),
        uris: result.uris,
    };
}

async function swiftForSource(source: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource(schemaSourceForSource(source));

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "swift" });
    return result.lines.join("\n");
}

async function generateTypeScriptForSource(source: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource(schemaSourceForSource(source));
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true, "prefer-unions": false },
    });
    return result.lines.join("\n");
}

describe("schemaForTypeScriptSources", () => {
    test("preserves class property declaration order in generated output", async () => {
        const output = await swiftForSource(`
            class A {
                name: string;
                age: number;
            }
        `);

        const nameIndex = output.indexOf("let name: String");
        const ageIndex = output.indexOf("let age: Double");
        expect(nameIndex).toBeGreaterThanOrEqual(0);
        expect(ageIndex).toBeGreaterThanOrEqual(0);
        expect(nameIndex).toBeLessThan(ageIndex);
    });

    test("converts a simple interface", () => {
        const { schema, uris } = schemaForSource(`
            export interface Person {
                name: string;
                age?: number;
            }
        `);

        const person = schema.definitions.Person;
        expect(person.type).toBe("object");
        expect(person.properties.name.type).toBe("string");
        expect(person.properties.age.type).toBe("number");
        expect(person.required).toEqual(["name"]);
        expect(person.additionalProperties).toBe(false);
        expect(uris).toEqual(["#/definitions/"]);
    });

    test("a #TopLevel marker selects the top-level type and is stripped", () => {
        const { name, schema, uris } = schemaForSource(`
            /**
             * The root type. #TopLevel
             */
            export interface Root {
                id: number;
                child: Child;
            }

            export interface Child {
                label: string;
            }
        `);

        expect(name).toBe("Root");
        expect(uris).toEqual(["#/definitions/Root"]);
        expect(schema.definitions.Root.description).not.toContain("#TopLevel");
    });

    test("export default types are rewritten to a named ref", () => {
        const { name, schema } = schemaForSource(`
            export default interface Person {
                name: string;
            }
        `);

        expect(name).toBe("Person");
        expect(schema.definitions.default).toEqual({
            $ref: "#/definitions/Person",
        });
        expect(schema.definitions.Person.type).toBe("object");
    });

    // https://github.com/glideapps/quicktype/issues/2695
    test("strips braces from JSDoc type annotations", () => {
        const { schema } = schemaForSource(`
            export type Person = {
                /**
                 * @type {string}
                 * @memberOf {Person}
                 */
                name: string;
            };

            export type MemberInfo = Required<Person>;
        `);

        expect(schema.definitions.Person.properties.name.type).toBe("string");
    });

    test("class property initializers become defaults", () => {
        const { schema } = schemaForSource(`
            export class Config {
                public name: string = "default-name";

                public count: number = 42;
            }
        `);

        const config = schema.definitions.Config;
        expect(config.properties.name.default).toBe("default-name");
        expect(config.properties.count.default).toBe(42);
    });

    test("string enums preserve their member names in the schema", () => {
        const { schema } = schemaForSource(`
            export enum TestEnum {
                Foo = "000",
                Bar = "001",
                Baz = "002",
            }
        `);

        expect(schema.definitions.TestEnum["qt-accessors"]).toEqual({
            "000": "Foo",
            "001": "Bar",
            "002": "Baz",
        });
    });

    test("string enum member names survive through TypeScript output", async () => {
        const output = await generateTypeScriptForSource(`
            export enum TestEnum {
                Foo = "000",
                Bar = "001",
                Baz = "002",
            }
        `);

        expect(output).toContain('Foo = "000"');
        expect(output).toContain('Bar = "001"');
        expect(output).toContain('Baz = "002"');
        expect(output).not.toMatch(/The00[0-2]/);
    });

    // The previously used fork of typescript-json-schema threw
    // "Unsupported type: bigint" here.
    test("bigint properties are converted to numbers", () => {
        const { schema } = schemaForSource(`
            export interface WithBigint {
                big: bigint;
            }
        `);

        expect(schema.definitions.WithBigint.properties.big.type).toBe(
            "number",
        );
    });

    // https://github.com/glideapps/quicktype/issues/2935
    test("Date properties become date-time strings", () => {
        const { schema } = schemaForSource(`
            export interface User {
                id: number;
                createdAt: Date;
            }
        `);

        expect(schema.definitions.User.properties.createdAt).toMatchObject({
            type: "string",
            format: "date-time",
        });
    });

    // https://github.com/glideapps/quicktype/issues/1858
    test("Map properties become map schemas", () => {
        const { schema } = schemaForSource(`
            export interface Env {
                flags: Map<string, boolean>;
                services: Map<string, Service>;
                nested: ReadonlyMap<string, Map<string, number>>;
            }

            export interface Service {
                url: string;
            }
        `);

        const properties = schema.definitions.Env.properties;
        expect(properties.flags).toMatchObject({
            type: "object",
            additionalProperties: { type: "boolean" },
        });
        expect(properties.services.additionalProperties.$ref).toBe(
            "#/definitions/Service",
        );
        expect(properties.nested.additionalProperties).toMatchObject({
            type: "object",
            additionalProperties: { type: "number" },
        });
    });

    test("a user-defined Map type is not treated as the built-in Map", () => {
        const { schema } = schemaForSource(`
            export interface Map {
                width: number;
            }

            export interface Atlas {
                map: Map;
            }
        `);

        expect(schema.definitions.Map.properties.width.type).toBe("number");
    });

    test("unsupported built-in types are reported with a helpful message", () => {
        expect(() =>
            schemaForSource(`
                export interface Bag {
                    tags: Set<string>;
                }
            `),
        ).toThrow(/does not support 'Set<string>'/);
    });

    test("compiler errors are reported as quicktype errors", () => {
        expect(() =>
            schemaForSource(`
                export interface Broken {
                    name: DoesNotExist;
                }
            `),
        ).toThrow(/TypeScript error/);
    });
});
