import { expect, it } from "vitest";

import commandLineArgs from "command-line-args";

import { Chance } from "../../packages/quicktype-core/src/support/Chance";
import {
    makeOptionDefinitions,
    transformDefinition,
} from "../../src/optionDefinitions";

const optionsDefinitions = makeOptionDefinitions([]);
const chance = new Chance(0);

it("should call command-line-args when all cli options are given", () => {
    const randomStrings: Record<number, string> = {};

    const argv = optionsDefinitions.reduce((strArr, def, i) => {
        if (def.optionType === "string") {
            const randomString = chance.animal();
            randomStrings[i] = randomString;

            return strArr.concat([`--${def.name}`, randomString]);
        }

        return strArr.concat([`--${def.name}`]);
    }, [] as string[]);

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
