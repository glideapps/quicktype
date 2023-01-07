import * as _ from "lodash";

import { SourceType, Source } from "../quicktype";
import { sourcesFromPostmanCollection } from "quicktype-core";

const wordwrap: (s: string) => string = require("wordwrap")(90);

interface MultiSampleDataSample {
    name: string;
    data: any;
}

interface MultiSampleDataSource {
    name: string;
    samples: MultiSampleDataSample[];
}

type SourceData = {
    name: string;
    sourceType: SourceType;
    leadingComments?: string[];
    sources: Source[];
};

function removeExtension(path: string) {
    const i = path.lastIndexOf(".");
    return i === -1 ? path : path.substr(0, i);
}

function sourcesFromMultiJSONData(name: string, data: any): SourceData {
    function toSource(source: MultiSampleDataSource): Source {
        return {
            topLevelName: source.name,
            samples: source.samples.map(sample => ({
                name: sample.name,
                source: JSON.stringify(sample.data, null, 2)
            }))
        };
    }

    const sources = data as MultiSampleDataSource[];
    return {
        name,
        sources: sources.map(toSource),
        sourceType: SourceType.Multiple
    };
}

export function sourcesFromPostman(name: string, data: any): SourceData {
    const jsonSource = _.isString(data) ? data : JSON.stringify(data);
    const collection = sourcesFromPostmanCollection(jsonSource);
    const leadingComments =
        collection.description === undefined ? undefined : wordwrap(collection.description).split("\n");
    return {
        name,
        sourceType: SourceType.Postman,
        leadingComments,
        sources: collection.sources.map(s => ({
            topLevelName: s.name,
            description: s.description ? wordwrap(s.description) : undefined,
            samples: s.samples.map((sample, i) => ({
                name: `example${i + 1}.json`,
                source: JSON.stringify(JSON.parse(sample as string), null, 2)
            }))
        }))
    };
}

function makeSources(sourceType: SourceType, name: string, data: any): SourceData {
    switch (sourceType) {
        case SourceType.Postman:
            return sourcesFromPostman(name, data);
        case SourceType.Multiple:
            return sourcesFromMultiJSONData(name, data);
        default:
            const topLevelName = _.upperFirst(_.camelCase(removeExtension(name)));
            const jsonSource = JSON.stringify(data, null, 2);
            const source = { topLevelName, samples: [{ name, source: jsonSource }] };
            return { name: topLevelName, sources: [source], sourceType };
    }
}

async function readFile(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let reader = new FileReader();
        reader.onerror = reject;
        reader.onload = e => {
            const { result } = e.target as any;
            return resolve(result);
        };
        reader.readAsText(file as Blob);
    });
}

async function sourceFromFile(file: File): Promise<Source> {
    const topLevelName = _.upperFirst(_.camelCase(removeExtension(file.name)));
    const source = await readFile(file);
    return {
        topLevelName,
        samples: [{ name: file.name, source }]
    };
}

export async function fromFiles(files: File[]): Promise<SourceData> {
    // TODO how do we make this not block so hard for large files?
    let sources = await Promise.all(files.map(sourceFromFile));
    if (files.length === 1) {
        const file = files[0];
        if (file.name.includes("postman_collection")) {
            const name = files[0].name.split(".")[0];
            const collectionSource = sources[0].samples[0].source;
            return sourcesFromPostman(name, collectionSource);
        } else if (file.name.includes("schema")) {
            return {
                name: "TopLevel",
                sources,
                sourceType: SourceType.Schema
            };
        } else {
            return {
                name: "TopLevel",
                sources,
                sourceType: SourceType.JSON
            };
        }
    } else {
        return {
            name: "TopLevel",
            sources,
            sourceType: SourceType.Multiple
        };
    }
}

export type SampleName = string;

const sampleSources: Record<string, any> = {
    "welcome.json": require("./welcome.json"),
    "pokedex.json": require("./pokedex.json"),
    "temperatures.json": require("./us-temperatures.json"),
    "music.json": require("./music.json"),
    "coordinate.json": require("./coordinate.json"),
    "pokedex-schema.json": require("./pokedex-schema.json"),
    "postman-echo.json": require("./Postman Echo.postman_collection.json")
};

export const samples: [SourceType, string[]][] = [
    [SourceType.JSON, ["welcome.json", "pokedex.json", "temperatures.json"]],
    [SourceType.Multiple, ["music.json"]],
    [SourceType.Schema, ["coordinate.json", "pokedex-schema.json"]],
    [SourceType.Postman, ["postman-echo.json"]]
];

export function samplesForSourceType(type: SourceType): string[] | undefined {
    const sampleData = samples.find(([t]) => t === type);
    return sampleData === undefined ? undefined : sampleData[1];
}

export function sourceTypeForSample(name: string): SourceType | undefined {
    const sampleData = samples.find(([_type, values]) => _.includes(values, name));
    return sampleData === undefined ? undefined : sampleData[0];
}

export function lookupSample(name: string): SourceData | undefined {
    const sourceType = sourceTypeForSample(name);

    if (sourceType === undefined && !_.endsWith(name, ".json")) {
        return lookupSample(name + ".json");
    }

    if (sourceType === undefined) {
        return undefined;
    }

    const data = sampleSources[name];
    if (data !== undefined) {
        return makeSources(sourceType, name, data);
    }

    return undefined;
}
