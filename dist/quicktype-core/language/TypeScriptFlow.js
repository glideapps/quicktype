"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Strings_1 = require("../support/Strings");
const Source_1 = require("../Source");
const Naming_1 = require("../Naming");
const RendererOptions_1 = require("../RendererOptions");
const JavaScript_1 = require("./JavaScript");
const Support_1 = require("../support/Support");
const JavaScriptUnicodeMaps_1 = require("./JavaScriptUnicodeMaps");
exports.tsFlowOptions = Object.assign({}, JavaScript_1.javaScriptOptions, {
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Interfaces only", false),
    nicePropertyNames: new RendererOptions_1.BooleanOption("nice-property-names", "Transform property names to be JavaScripty", false),
    declareUnions: new RendererOptions_1.BooleanOption("explicit-unions", "Explicitly name unions", false),
    preferUnions: new RendererOptions_1.BooleanOption("prefer-unions", "Use union type instead of enum", false)
});
const tsFlowTypeAnnotations = {
    any: ": any",
    anyArray: ": any[]",
    anyMap: ": { [k: string]: any }",
    string: ": string",
    stringArray: ": string[]",
    boolean: ": boolean"
};
class TypeScriptFlowBaseTargetLanguage extends JavaScript_1.JavaScriptTargetLanguage {
    getOptions() {
        return [
            exports.tsFlowOptions.justTypes,
            exports.tsFlowOptions.nicePropertyNames,
            exports.tsFlowOptions.declareUnions,
            exports.tsFlowOptions.runtimeTypecheck,
            exports.tsFlowOptions.runtimeTypecheckIgnoreUnknownProperties,
            exports.tsFlowOptions.acronymStyle,
            exports.tsFlowOptions.converters,
            exports.tsFlowOptions.rawType,
            exports.tsFlowOptions.preferUnions
        ];
    }
    get supportsOptionalClassProperties() {
        return true;
    }
}
exports.TypeScriptFlowBaseTargetLanguage = TypeScriptFlowBaseTargetLanguage;
class TypeScriptTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new TypeScriptRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.tsFlowOptions, untypedOptionValues));
    }
}
exports.TypeScriptTargetLanguage = TypeScriptTargetLanguage;
function quotePropertyName(original) {
    const escaped = Strings_1.utf16StringEscape(original);
    const quoted = `"${escaped}"`;
    if (original.length === 0) {
        return quoted;
    }
    else if (!JavaScriptUnicodeMaps_1.isES3IdentifierStart(original.codePointAt(0))) {
        return quoted;
    }
    else if (escaped !== original) {
        return quoted;
    }
    else if (JavaScript_1.legalizeName(original) !== original) {
        return quoted;
    }
    else {
        return original;
    }
}
class TypeScriptFlowBaseRenderer extends JavaScript_1.JavaScriptRenderer {
    constructor(targetLanguage, renderContext, _tsFlowOptions) {
        super(targetLanguage, renderContext, _tsFlowOptions);
        this._tsFlowOptions = _tsFlowOptions;
    }
    namerForObjectProperty() {
        if (this._tsFlowOptions.nicePropertyNames) {
            return Naming_1.funPrefixNamer("properties", s => this.nameStyle(s, false));
        }
        else {
            return super.namerForObjectProperty();
        }
    }
    sourceFor(t) {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return Source_1.singleWord(this.nameForNamedType(t));
        }
        return TypeUtils_1.matchType(t, _anyType => Source_1.singleWord("any"), _nullType => Source_1.singleWord("null"), _boolType => Source_1.singleWord("boolean"), _integerType => Source_1.singleWord("number"), _doubleType => Source_1.singleWord("number"), _stringType => Source_1.singleWord("string"), arrayType => {
            const itemType = this.sourceFor(arrayType.items);
            if ((arrayType.items instanceof Type_1.UnionType && !this._tsFlowOptions.declareUnions) ||
                arrayType.items instanceof Type_1.ArrayType) {
                return Source_1.singleWord(["Array<", itemType.source, ">"]);
            }
            else {
                return Source_1.singleWord([Source_1.parenIfNeeded(itemType), "[]"]);
            }
        }, _classType => Support_1.panic("We handled this above"), mapType => Source_1.singleWord(["{ [key: string]: ", this.sourceFor(mapType.values).source, " }"]), _enumType => Support_1.panic("We handled this above"), unionType => {
            if (!this._tsFlowOptions.declareUnions || TypeUtils_1.nullableFromUnion(unionType) !== null) {
                const children = Array.from(unionType.getChildren()).map(c => Source_1.parenIfNeeded(this.sourceFor(c)));
                return Source_1.multiWord(" | ", ...children);
            }
            else {
                return Source_1.singleWord(this.nameForNamedType(unionType));
            }
        }, transformedStringType => {
            if (transformedStringType.kind === "date-time") {
                return Source_1.singleWord("Date");
            }
            return Source_1.singleWord("string");
        });
    }
    emitClassBlockBody(c) {
        this.emitPropertyTable(c, (name, _jsonName, p) => {
            const t = p.type;
            return [
                [Source_1.modifySource(quotePropertyName, name), p.isOptional ? "?" : "", ": "],
                [this.sourceFor(t).source, ";"]
            ];
        });
    }
    emitClass(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassBlock(c, className);
    }
    emitUnion(u, unionName) {
        if (!this._tsFlowOptions.declareUnions) {
            return;
        }
        this.emitDescription(this.descriptionForType(u));
        const children = Source_1.multiWord(" | ", ...Array.from(u.getChildren()).map(c => Source_1.parenIfNeeded(this.sourceFor(c))));
        this.emitLine("export type ", unionName, " = ", children.source, ";");
    }
    emitTypes() {
        this.forEachNamedType("leading-and-interposing", (c, n) => this.emitClass(c, n), (e, n) => this.emitEnum(e, n), (u, n) => this.emitUnion(u, n));
    }
    emitUsageComments() {
        if (this._tsFlowOptions.justTypes)
            return;
        super.emitUsageComments();
    }
    deserializerFunctionLine(t, name) {
        const jsonType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["function to", name, "(json: ", jsonType, "): ", this.sourceFor(t).source];
    }
    serializerFunctionLine(t, name) {
        const camelCaseName = Source_1.modifySource(Strings_1.camelCase, name);
        const returnType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["function ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): ", returnType];
    }
    get moduleLine() {
        return undefined;
    }
    get castFunctionLines() {
        return ["function cast<T>(val: any, typ: any): T", "function uncast<T>(val: T, typ: any): any"];
    }
    get typeAnnotations() {
        throw new Error("not implemented");
    }
    emitConvertModule() {
        if (this._tsFlowOptions.justTypes)
            return;
        super.emitConvertModule();
    }
    emitConvertModuleHelpers() {
        if (this._tsFlowOptions.justTypes)
            return;
        super.emitConvertModuleHelpers();
    }
    emitModuleExports() {
        if (this._tsFlowOptions.justTypes) {
            return;
        }
        else {
            super.emitModuleExports();
        }
    }
}
exports.TypeScriptFlowBaseRenderer = TypeScriptFlowBaseRenderer;
class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    forbiddenNamesForGlobalNamespace() {
        return ["Array", "Date"];
    }
    deserializerFunctionLine(t, name) {
        const jsonType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["public static to", name, "(json: ", jsonType, "): ", this.sourceFor(t).source];
    }
    serializerFunctionLine(t, name) {
        const camelCaseName = Source_1.modifySource(Strings_1.camelCase, name);
        const returnType = this._tsFlowOptions.rawType === "json" ? "string" : "any";
        return ["public static ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): ", returnType];
    }
    get moduleLine() {
        return "export class Convert";
    }
    get typeAnnotations() {
        return Object.assign({ never: ": never" }, tsFlowTypeAnnotations);
    }
    emitModuleExports() {
        return;
    }
    emitUsageImportComment() {
        const topLevelNames = [];
        this.forEachTopLevel("none", (_t, name) => {
            topLevelNames.push(", ", name);
        }, TypeUtils_1.isNamedType);
        this.emitLine("//   import { Convert", topLevelNames, ' } from "./file";');
    }
    emitEnum(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        if (this._tsFlowOptions.preferUnions) {
            let items = "";
            e.cases.forEach((item) => {
                if (items === "") {
                    items += `"${Strings_1.utf16StringEscape(item)}"`;
                    return;
                }
                items += ` | "${Strings_1.utf16StringEscape(item)}"`;
            });
            this.emitLine("export type ", enumName, " = ", items, ";");
        }
        else {
            this.emitBlock(["export enum ", enumName, " "], "", () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(name, ` = "${Strings_1.utf16StringEscape(jsonName)}",`);
                });
            });
        }
    }
    emitClassBlock(c, className) {
        this.emitBlock(["export interface ", className, " "], "", () => {
            this.emitClassBlockBody(c);
        });
    }
}
exports.TypeScriptRenderer = TypeScriptRenderer;
class FlowTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor() {
        super("Flow", ["flow"], "js");
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new FlowRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.tsFlowOptions, untypedOptionValues));
    }
}
exports.FlowTargetLanguage = FlowTargetLanguage;
class FlowRenderer extends TypeScriptFlowBaseRenderer {
    forbiddenNamesForGlobalNamespace() {
        return ["Class", "Date", "Object", "String", "Array", "JSON", "Error"];
    }
    get typeAnnotations() {
        return Object.assign({ never: "" }, tsFlowTypeAnnotations);
    }
    emitEnum(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        const lines = [];
        this.forEachEnumCase(e, "none", (_, jsonName) => {
            const maybeOr = lines.length === 0 ? "  " : "| ";
            lines.push([maybeOr, '"', Strings_1.utf16StringEscape(jsonName), '"']);
        });
        Support_1.defined(lines[lines.length - 1]).push(";");
        this.emitLine("export type ", enumName, " =");
        this.indent(() => {
            for (const line of lines) {
                this.emitLine(line);
            }
        });
    }
    emitClassBlock(c, className) {
        this.emitBlock(["export type ", className, " = "], ";", () => {
            this.emitClassBlockBody(c);
        });
    }
    emitSourceStructure() {
        this.emitLine("// @flow");
        this.ensureBlankLine();
        super.emitSourceStructure();
    }
}
exports.FlowRenderer = FlowRenderer;
