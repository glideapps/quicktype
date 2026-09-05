import { afterEach, describe, expect, it, vi } from "vitest";

import { inferenceFlagNames, type InferenceFlagName } from "quicktype-core";

import type { CLIOptions } from "../../src/CLIOptions.types";
import { inferCLIOptions } from "../../src/inference";
import { makeQuicktypeOptions } from "../../src/quicktype.options";
import { negatedInferenceFlagName } from "../../src/utils";
import * as sources from "../../src/sources";
import * as usage from "../../src/usage";

vi.mock("../../src/input", () => ({
    makeInputData: vi.fn().mockResolvedValue("inputData"),
}));
vi.mock("../../src/sources", () => ({
    getSources: vi.fn().mockResolvedValue([]),
    makeTypeScriptSource: vi.fn().mockReturnValue({
        kind: "schema",
        name: "TypeScript",
        uris: [],
    }),
}));
vi.mock("../../src/usage", () => ({
    displayUsage: vi.fn(),
}));

afterEach(() => {
    vi.clearAllMocks();
});

function inferredOptions(overrides: Partial<CLIOptions> = {}): CLIOptions {
    return inferCLIOptions(
        {
            lang: "typescript",
            src: ["input.json"],
            ...overrides,
        },
        undefined,
    );
}

describe("makeQuicktypeOptions", () => {
    it("displays usage and returns no options for --help", async () => {
        const result = await makeQuicktypeOptions(
            inferredOptions({ help: true }),
        );

        expect(usage.displayUsage).toHaveBeenCalledOnce();
        expect(result).toBeUndefined();
    });

    it("builds options for JSON and TypeScript inputs", async () => {
        const jsonResult = await makeQuicktypeOptions(inferredOptions());
        expect(sources.getSources).toHaveBeenCalledOnce();
        expect(jsonResult).toMatchObject({ inputData: "inputData" });

        const typescriptResult = await makeQuicktypeOptions(
            inferredOptions({ src: ["input.ts"] }),
        );
        expect(sources.makeTypeScriptSource).toHaveBeenCalledWith(["input.ts"]);
        expect(typescriptResult).toMatchObject({ inputData: "inputData" });
    });

    it("sets debug options", async () => {
        const result = await makeQuicktypeOptions(
            inferredOptions({ debug: "print-graph,provenance" }),
        );

        expect(result?.debugPrintGraph).toBe(true);
        expect(result?.checkProvenance).toBe(true);
    });

    it("keeps every inference flag enabled by default", async () => {
        const result = await makeQuicktypeOptions(inferredOptions());

        for (const flagName of inferenceFlagNames) {
            expect(result?.[flagName], flagName).toBe(true);
        }
    });

    it("honors negated inference flags from the CLI pipeline", async () => {
        const flagName: InferenceFlagName = inferenceFlagNames[0];
        const negatedFlagName = negatedInferenceFlagName(flagName);
        const result = await makeQuicktypeOptions(
            inferredOptions({ [negatedFlagName]: true }),
        );

        expect(result?.[flagName]).toBe(false);
    });

    it("honors positive inference flags supplied through the API", async () => {
        const flagName: InferenceFlagName = inferenceFlagNames[0];
        const result = await makeQuicktypeOptions(
            inferredOptions({ [flagName]: false }),
        );

        expect(result?.[flagName]).toBe(false);
    });
});
