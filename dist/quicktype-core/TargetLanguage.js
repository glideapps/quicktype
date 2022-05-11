"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Source_1 = require("./Source");
const Support_1 = require("./support/Support");
const DateTime_1 = require("./DateTime");
class TargetLanguage {
    constructor(displayName, names, extension) {
        this.displayName = displayName;
        this.names = names;
        this.extension = extension;
    }
    get optionDefinitions() {
        return this.getOptions().map(o => o.definition);
    }
    get cliOptionDefinitions() {
        let actual = [];
        let display = [];
        for (const { cliDefinitions } of this.getOptions()) {
            actual = actual.concat(cliDefinitions.actual);
            display = display.concat(cliDefinitions.display);
        }
        return { actual, display };
    }
    get name() {
        return Support_1.defined(this.names[0]);
    }
    renderGraphAndSerialize(typeGraph, givenOutputFilename, alphabetizeProperties, leadingComments, rendererOptions, indentation) {
        if (indentation === undefined) {
            indentation = this.defaultIndentation;
        }
        const renderContext = { typeGraph, leadingComments };
        const renderer = this.makeRenderer(renderContext, rendererOptions);
        if (renderer.setAlphabetizeProperties !== undefined) {
            renderer.setAlphabetizeProperties(alphabetizeProperties);
        }
        const renderResult = renderer.render(givenOutputFilename);
        return collection_utils_1.mapMap(renderResult.sources, s => Source_1.serializeRenderResult(s, renderResult.names, Support_1.defined(indentation)));
    }
    get defaultIndentation() {
        return "    ";
    }
    get stringTypeMapping() {
        return new Map();
    }
    get supportsOptionalClassProperties() {
        return false;
    }
    get supportsUnionsWithBothNumberTypes() {
        return false;
    }
    get supportsFullObjectType() {
        return false;
    }
    needsTransformerForType(_t) {
        return false;
    }
    get dateTimeRecognizer() {
        return new DateTime_1.DefaultDateTimeRecognizer();
    }
}
exports.TargetLanguage = TargetLanguage;
