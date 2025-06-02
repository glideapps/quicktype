import { describe, expect, it, beforeEach } from "vitest";

import commandLineArgs from "command-line-args";

import type { Option } from "../../packages/quicktype-core";
import type { EnumOption } from "../../packages/quicktype-core/dist/RendererOptions";
import { Chance } from "../../packages/quicktype-core/src/support/Chance";
import { all as sourceLanguages } from "../../packages/quicktype-core/dist/language/All";

import { parseOptions } from "../../src/cli.options";
import {
    makeOptionDefinitions,
    transformDefinition,
} from "../../src/optionDefinitions";

import * as fixtureLanguages from "../languages";

const optionsDefinitions = makeOptionDefinitions([]);
const chance = new Chance(0);

let randomStrings: Record<number, string> = {};
let argv: string[] = [];

beforeEach(() => {
    randomStrings = {};
    argv = optionsDefinitions.reduce((strArr, def, i) => {
        if (def.optionType === "string") {
            const randomString = chance.animal();
            randomStrings[i] = randomString;

            return strArr.concat([`--${def.name}`, randomString]);
        }

        return strArr.concat([`--${def.name}`]);
    }, [] as string[]);
});

it("should call command-line-args for all generic cli options", () => {
    const args = commandLineArgs(optionsDefinitions.map(transformDefinition), {
        argv,
        partial: true,
    });

    const expectedOutput = optionsDefinitions.reduce((acc, def, i) => {
        if (def.optionType === "string") {
            if (def.multiple) {
                acc[def.name] = [randomStrings[i]];
            } else {
                acc[def.name] = randomStrings[i];
            }
            return acc;
        }

        acc[def.name] = true;
        return acc;
    }, {});

    expect(args).toStrictEqual(expectedOutput);
});

for (const [name, fixtureLanguage] of Object.entries(fixtureLanguages)) {
    const languageClass = sourceLanguages.find((lang) =>
        (lang.names as readonly string[]).includes(fixtureLanguage.name),
    );

    if (!languageClass) {
        // it.skip(`does not have language fixture for ${fixtureLanguage.name} language`, () => {});
        continue;
    }

    const fixtureRendererOptionsEntries = [
        fixtureLanguage.rendererOptions,
        ...fixtureLanguage.quickTestRendererOptions,
    ].flatMap((optionsObj) => Object.entries(optionsObj));

    const dedupeKeys = {};
    const rendererOptionsArgv = fixtureRendererOptionsEntries.reduce(
        (strArr, [k, v]) => {
            if (k in dedupeKeys) {
                return strArr;
            }

            dedupeKeys[k] = true;
            return strArr.concat([`--${k}`, v as string]);
        },
        [] as string[],
    );

    it(`should parse rendererOptions for ${name} fixture`, () => {
        const parsedOptions = parseOptions(
            optionsDefinitions.concat(
                languageClass.cliOptionDefinitions.actual,
            ),
            argv.concat(rendererOptionsArgv),
            true,
        );
        const options = languageClass.getOptions();

        const isAllRendererOptionsValid =
            parsedOptions.rendererOptions &&
            (Object.values(options) as Option<string, unknown>[]).every(
                (option) => {
                    const parsedValue =
                        parsedOptions.rendererOptions?.[option.name];

                    if (option.definition.optionType === "enum") {
                        try {
                            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
                            (option as EnumOption<string, any>).getEnumValue(
                                parsedValue,
                            );
                            return true;
                        } catch {
                            return false;
                        }
                    }

                    // biome-ignore lint/suspicious/useValidTypeof: optionType is only 'string' | 'boolean' in this case
                    return option.definition.optionType === typeof parsedValue;
                },
            );

        expect(isAllRendererOptionsValid).toBeTruthy();
    });
}
