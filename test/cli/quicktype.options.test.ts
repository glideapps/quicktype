/** Generated unit test */
import { describe, expect, it, vi } from "vitest";

import { makeQuicktypeOptions } from "../../src/quicktype.options";

import * as fs from "node:fs";
import * as usage from "../../src/usage";
import * as sources from "../../src/sources";
import * as graphql from "../../src/GraphQLIntrospection";
import * as quicktypeCore from "quicktype-core";

vi.mock("node:fs", () => ({
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
}));
vi.mock("../../src/usage", () => ({
    displayUsage: vi.fn(),
}));
vi.mock("../../src/input", () => ({
    makeInputData: vi.fn().mockResolvedValue("inputData"),
}));
vi.mock("../../src/sources", () => ({
    getSources: vi.fn().mockResolvedValue([{ kind: "json", name: "test" }]),
    makeTypeScriptSource: vi
        .fn()
        .mockReturnValue({ kind: "typescript", name: "ts" }),
}));
vi.mock("../../src/GraphQLIntrospection", () => ({
    introspectServer: vi.fn().mockResolvedValue('{"__schema":{}}'),
}));
vi.mock("quicktype-core", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-expect-error
        ...mod,
        parseJSON: vi.fn().mockReturnValue({}),
        getStream: vi.fn().mockResolvedValue("query"),
        readableFromFileOrURL: vi.fn().mockResolvedValue("stream"),
        sourcesFromPostmanCollection: vi.fn().mockReturnValue({
            sources: ["postmanSrc"],
            description: "desc",
        }),
        trainMarkovChain: vi.fn().mockReturnValue({ chain: true }),
        isLanguageName: vi
            .fn()
            .mockImplementation(
                (lang) => lang === "typescript" || lang === "json",
            ),
        languageNamed: vi.fn().mockReturnValue({ name: "typescript" }),
        messageError: vi.fn().mockReturnValue("error"),
        inferenceFlagNames: ["inferMaps", "inferEnums"],
        negatedInferenceFlagName: (flag) =>
            `no${flag[0].toUpperCase()}${flag.slice(1)}`,
        defined: vi.fn((x) => x),
        defaultTargetLanguages: [],
    };
});
vi.mock("../../src/utils", async (importOriginal) => {
    const mod = await importOriginal();
    return {
        // @ts-expect-error
        ...mod,
        stringSourceDataToStreamSourceData: vi
            .fn()
            .mockReturnValue({ data: "stream" }),
        typeNameFromFilename: vi.fn().mockReturnValue("TypeName"),
        negatedInferenceFlagName: (flag) =>
            `no${flag[0].toUpperCase()}${flag.slice(1)}`,
    };
});

describe("makeQuicktypeOptions", () => {
    const baseOptions = {
        lang: "typescript",
        srcLang: "json",
        src: ["input.json"],
        rendererOptions: {},
        debug: undefined,
        out: "output.ts",
        help: undefined,
        version: undefined,
        buildMarkovChain: undefined,
        graphqlIntrospect: undefined,
        graphqlSchema: undefined,
        httpHeader: undefined,
        topLevel: undefined,
        additionalSchema: undefined,
        alphabetizeProperties: false,
        allPropertiesOptional: false,
        noRender: false,
    };

    // afterEach(() => {
    //     vi.clearAllMocks();
    // });

    it("should call displayUsage and return undefined if help is set", async () => {
        const options = { ...baseOptions, help: true };
        const spy = vi.spyOn(usage, "displayUsage");
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(spy).toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it("should log version and return undefined if version is set", async () => {
        const options = { ...baseOptions, version: true };
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(logSpy).toHaveBeenCalled();
        expect(result).toBeUndefined();
        logSpy.mockRestore();
    });

    it("should handle buildMarkovChain option", async () => {
        const options = { ...baseOptions, buildMarkovChain: "file.txt" };
        const readSpy = vi
            .spyOn(fs, "readFileSync")
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            .mockReturnValue("a\nb\nc" as any);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(readSpy).toHaveBeenCalledWith("file.txt");
        expect(logSpy).toHaveBeenCalled();
        expect(result).toBeUndefined();
        logSpy.mockRestore();
    });

    it("should handle JSON srcLang and call getSources", async () => {
        const options = { ...baseOptions, srcLang: "json" };
        const getSourcesSpy = vi.spyOn(sources, "getSources");
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(getSourcesSpy).toHaveBeenCalled();
        expect(result).toMatchObject({
            lang: { name: "typescript" },
            inputData: "inputData",
        });
    });

    it("should handle typescript srcLang and call makeTypeScriptSource", async () => {
        const options = { ...baseOptions, srcLang: "typescript" };
        const makeTSSpy = vi.spyOn(sources, "makeTypeScriptSource");
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(makeTSSpy).toHaveBeenCalledWith(options.src);
        expect(result).toMatchObject({
            lang: { name: "typescript" },
            inputData: "inputData",
        });
    });

    it("should handle postman srcLang and call sourcesFromPostmanCollection", async () => {
        const options = {
            ...baseOptions,
            srcLang: "postman",
            src: ["collection.json"],
        };
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        vi.spyOn(fs, "readFileSync").mockReturnValue("{}" as any);
        const spy = vi.spyOn(quicktypeCore, "sourcesFromPostmanCollection");
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(spy).toHaveBeenCalled();
        expect(result).toMatchObject({
            lang: { name: "typescript" },
            leadingComments: ["desc"],
            inputData: "inputData",
        });
    });

    it("should handle graphql srcLang with introspection and schema file", async () => {
        const options = {
            ...baseOptions,
            srcLang: "graphql",
            src: ["query.graphql"],
            graphqlIntrospect: "http://localhost/graphql",
            graphqlSchema: "schema.json",
        };
        const introspectSpy = vi.spyOn(graphql, "introspectServer");
        const writeSpy = vi.spyOn(fs, "writeFileSync");
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(introspectSpy).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledWith(
            "schema.json",
            expect.any(String),
        );
        expect(result).toMatchObject({
            lang: { name: "typescript" },
            inputData: "inputData",
        });
    });

    it("should return error for unknown srcLang", async () => {
        const options = { ...baseOptions, srcLang: "unknown" };
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(result).toBe("error");
    });

    it("should return error for unknown output language", async () => {
        const options = { ...baseOptions, lang: "unknown" };
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(result).toBe("error");
    });

    it("should set debug flags from options.debug", async () => {
        const options = { ...baseOptions, debug: "print-graph,provenance" };
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(result?.debugPrintGraph).toBe(true);
        expect(result?.checkProvenance).toBe(true);
    });

    it("should set inference flags from CLI options", async () => {
        const options = {
            ...baseOptions,
            noInferMaps: true,
            noInferEnums: false,
        };
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const result = await makeQuicktypeOptions(options as any);
        expect(result?.inferMaps).toBe(false);
        expect(result?.inferEnums).toBe(true);
    });
});
