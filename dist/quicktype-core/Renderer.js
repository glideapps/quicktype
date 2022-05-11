"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Naming_1 = require("./Naming");
const Source_1 = require("./Source");
const Annotation_1 = require("./Annotation");
const Support_1 = require("./support/Support");
function getBlankLineConfig(cfg) {
    if (Array.isArray(cfg)) {
        return { position: cfg[0], count: cfg[1] };
    }
    return { position: cfg, count: 1 };
}
function lineIndentation(line) {
    const len = line.length;
    let indent = 0;
    for (let i = 0; i < len; i++) {
        const c = line.charAt(i);
        if (c === " ") {
            indent += 1;
        }
        else if (c === "\t") {
            indent = (indent / 4 + 1) * 4;
        }
        else {
            return { indent, text: line.substring(i) };
        }
    }
    return { indent: 0, text: null };
}
class EmitContext {
    constructor() {
        this._currentEmitTarget = this._emitted = [];
        this._numBlankLinesNeeded = 0;
        this._preventBlankLine = true; // no blank lines at start of file
    }
    get isEmpty() {
        return this._emitted.length === 0;
    }
    get isNested() {
        return this._emitted !== this._currentEmitTarget;
    }
    get source() {
        return this._emitted;
    }
    pushItem(item) {
        this._currentEmitTarget.push(item);
        this._preventBlankLine = false;
    }
    emitNewline() {
        const nl = Source_1.newline();
        this.pushItem(nl);
        this._lastNewline = nl;
    }
    emitItem(item) {
        if (!this.isEmpty) {
            for (let i = 0; i < this._numBlankLinesNeeded; i++) {
                this.emitNewline();
            }
        }
        this._numBlankLinesNeeded = 0;
        this.pushItem(item);
    }
    containsItem(item) {
        const existingItem = this._currentEmitTarget.find((value) => item === value);
        return existingItem !== undefined;
    }
    ensureBlankLine(numBlankLines) {
        if (this._preventBlankLine)
            return;
        this._numBlankLinesNeeded = Math.max(this._numBlankLinesNeeded, numBlankLines);
    }
    preventBlankLine() {
        this._numBlankLinesNeeded = 0;
        this._preventBlankLine = true;
    }
    changeIndent(offset) {
        if (this._lastNewline === undefined) {
            return Support_1.panic("Cannot change indent for the first line");
        }
        this._lastNewline.indentationChange += offset;
    }
}
class Renderer {
    constructor(targetLanguage, renderContext) {
        this.targetLanguage = targetLanguage;
        this.emitTable = (tableArray) => {
            if (tableArray.length === 0)
                return;
            const table = tableArray.map(r => r.map(sl => Source_1.sourcelikeToSource(sl)));
            this._emitContext.emitItem({ kind: "table", table });
            this._emitContext.emitNewline();
        };
        this.typeGraph = renderContext.typeGraph;
        this.leadingComments = renderContext.leadingComments;
        this._finishedFiles = new Map();
        this._finishedEmitContexts = new Map();
        this._emitContext = new EmitContext();
    }
    ensureBlankLine(numBlankLines = 1) {
        this._emitContext.ensureBlankLine(numBlankLines);
    }
    preventBlankLine() {
        this._emitContext.preventBlankLine();
    }
    emitItem(item) {
        this._emitContext.emitItem(item);
    }
    emitItemOnce(item) {
        if (this._emitContext.containsItem(item)) {
            return false;
        }
        this.emitItem(item);
        return true;
    }
    emitLineOnce(...lineParts) {
        let lineEmitted = true;
        if (lineParts.length === 1) {
            lineEmitted = this.emitItemOnce(lineParts[0]);
        }
        else if (lineParts.length > 1) {
            lineEmitted = this.emitItemOnce(lineParts);
        }
        if (lineEmitted) {
            this._emitContext.emitNewline();
        }
    }
    emitLine(...lineParts) {
        if (lineParts.length === 1) {
            this._emitContext.emitItem(lineParts[0]);
        }
        else if (lineParts.length > 1) {
            this._emitContext.emitItem(lineParts);
        }
        this._emitContext.emitNewline();
    }
    emitMultiline(linesString) {
        const lines = linesString.split("\n");
        const numLines = lines.length;
        if (numLines === 0)
            return;
        this.emitLine(lines[0]);
        let currentIndent = 0;
        for (let i = 1; i < numLines; i++) {
            const line = lines[i];
            const { indent, text } = lineIndentation(line);
            Support_1.assert(indent % 4 === 0, "Indentation is not a multiple of 4.");
            if (text !== null) {
                const newIndent = indent / 4;
                this.changeIndent(newIndent - currentIndent);
                currentIndent = newIndent;
                this.emitLine(text);
            }
            else {
                this._emitContext.emitNewline();
            }
        }
        if (currentIndent !== 0) {
            this.changeIndent(-currentIndent);
        }
    }
    gatherSource(emitter) {
        const oldEmitContext = this._emitContext;
        this._emitContext = new EmitContext();
        emitter();
        Support_1.assert(!this._emitContext.isNested, "emit context not restored correctly");
        const source = this._emitContext.source;
        this._emitContext = oldEmitContext;
        return source;
    }
    emitGatheredSource(items) {
        for (const item of items) {
            this._emitContext.emitItem(item);
        }
    }
    emitAnnotated(annotation, emitter) {
        const lines = this.gatherSource(emitter);
        const source = Source_1.sourcelikeToSource(lines);
        this._emitContext.emitItem(Source_1.annotated(annotation, source));
    }
    emitIssue(message, emitter) {
        this.emitAnnotated(new Annotation_1.IssueAnnotationData(message), emitter);
    }
    changeIndent(offset) {
        this._emitContext.changeIndent(offset);
    }
    iterableForEach(iterable, emitter) {
        const items = Array.from(iterable);
        let onFirst = true;
        for (const [i, v] of collection_utils_1.iterableEnumerate(items)) {
            const position = items.length === 1 ? "only" : onFirst ? "first" : i === items.length - 1 ? "last" : "middle";
            emitter(v, position);
            onFirst = false;
        }
    }
    forEach(iterable, interposedBlankLines, leadingBlankLines, emitter) {
        let didEmit = false;
        this.iterableForEach(iterable, ([k, v], position) => {
            if (position === "only" || position === "first") {
                this.ensureBlankLine(leadingBlankLines);
            }
            else {
                this.ensureBlankLine(interposedBlankLines);
            }
            emitter(v, k, position);
            didEmit = true;
        });
        return didEmit;
    }
    forEachWithBlankLines(iterable, blankLineConfig, emitter) {
        const { position, count } = getBlankLineConfig(blankLineConfig);
        const interposing = ["interposing", "leading-and-interposing"].indexOf(position) >= 0;
        const leading = ["leading", "leading-and-interposing"].indexOf(position) >= 0;
        return this.forEach(iterable, interposing ? count : 0, leading ? count : 0, emitter);
    }
    indent(fn) {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }
    assignNames() {
        return Naming_1.assignNames(this.setUpNaming());
    }
    initializeEmitContextForFilename(filename) {
        if (this._finishedEmitContexts.has(filename.toLowerCase())) {
            const existingEmitContext = this._finishedEmitContexts.get(filename.toLowerCase());
            if (existingEmitContext !== undefined) {
                this._emitContext = existingEmitContext;
            }
        }
    }
    finishFile(filename) {
        if (this._finishedFiles.has(filename)) {
            console.log(`[WARNING] Tried to emit file ${filename} more than once. If performing multi-file output this warning can be safely ignored.`);
        }
        const source = Source_1.sourcelikeToSource(this._emitContext.source);
        this._finishedFiles.set(filename, source);
        // [Michael Fey (@MrRooni), 2019-5-9] We save the current EmitContext for possible reuse later. We put it into the map with a lowercased version of the key so we can do a case-insensitive lookup later. The reason we lowercase it is because some schema (looking at you keyword-unions.schema) define objects of the same name with different casing. BOOL vs. bool, for example.
        this._finishedEmitContexts.set(filename.toLowerCase(), this._emitContext);
        this._emitContext = new EmitContext();
    }
    render(givenOutputFilename) {
        this._names = this.assignNames();
        this.emitSource(givenOutputFilename);
        if (!this._emitContext.isEmpty) {
            this.finishFile(givenOutputFilename);
        }
        return { sources: this._finishedFiles, names: this._names };
    }
    get names() {
        if (this._names === undefined) {
            return Support_1.panic("Names accessed before they were assigned");
        }
        return this._names;
    }
}
exports.Renderer = Renderer;
