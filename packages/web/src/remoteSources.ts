import { camelCase, upperFirst } from "lodash";
import { sendEvent } from "./analytics";
import { Source, SourceType } from "./quicktype";
import { sourcesFromPostman } from "./samples";
import { SourcePadState } from "./types";
import { withoutExtension } from "./util";

async function loadSourcesFromGist(id: string): Promise<Array<{ source: Source; filename: string }>> {
    const gist = await fetch(`https://api.github.com/gists/${id}`).then(r => r.json());

    const sources: Array<{ source: Source; filename: string }> = Object.keys(gist.files).map(filename => ({
        filename,
        source: {
            topLevelName: upperFirst(camelCase(withoutExtension(filename))),
            samples: [{ name: filename, source: gist.files[filename].content }]
        }
    }));

    return sources;
}

async function loadSourceFromRawFile(url: string): Promise<{ source: Source; filename: string }> {
    const source = await fetch(url).then(r => r.text());
    const filename = url.substring(url.lastIndexOf("/") + 1);
    return {
        filename,
        source: {
            topLevelName: upperFirst(camelCase(withoutExtension(filename))),
            samples: [{ name: filename, source }]
        }
    };
}

function sourceStateFromSources(sources: Array<{ source: Source; filename: string }>): SourcePadState | undefined {
    if (sources.length === 0) {
        return undefined;
    }

    let sourceType, sample;
    if (sources.length === 1) {
        const { filename, source } = sources[0];
        sample = upperFirst(camelCase(withoutExtension(filename)));
        if (filename.includes("schema")) {
            sourceType = SourceType.Schema;
        } else if (filename.includes("postman_collection")) {
            const sourceData = sourcesFromPostman(filename, source.samples[0].source);
            return {
                sample: sourceData.name,
                sources: sourceData.sources,
                sourceType: SourceType.Postman,
                selectedNode: 0,
                expandedNodes: [],
                leadingComments: sourceData.leadingComments
            };
        } else {
            sourceType = SourceType.JSON;
        }
    } else {
        sourceType = SourceType.Multiple;
        sample = "Multiple";
    }

    return {
        sample,
        sources: sources.map(s => s.source),
        sourceType,
        selectedNode: 0,
        expandedNodes: []
    };
}

async function loadIncomingGist(gistId: string): Promise<SourcePadState | undefined> {
    try {
        const sources = await loadSourcesFromGist(gistId);
        const state = sourceStateFromSources(sources);
        sendEvent("App", state === undefined ? "gist error" : "load gist", gistId);
        return state;
    } catch (error) {
        console.error("Could not load gist", error);
        return undefined;
    }
}

async function loadIncomingHref(href: string): Promise<SourcePadState | undefined> {
    try {
        const source = await loadSourceFromRawFile(href);
        const state = sourceStateFromSources([source]);
        sendEvent("App", state === undefined ? "load href error" : "load href", href);
        return state;
    } catch (error) {
        console.error("Could not load href", error);
        return undefined;
    }
}
