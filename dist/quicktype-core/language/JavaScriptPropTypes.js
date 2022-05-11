"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TargetLanguage_1 = require("../TargetLanguage");
const RendererOptions_1 = require("../RendererOptions");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const Naming_1 = require("../Naming");
const Acronyms_1 = require("../support/Acronyms");
const __1 = require("..");
const Strings_1 = require("../support/Strings");
const JavaScriptUnicodeMaps_1 = require("./JavaScriptUnicodeMaps");
const JavaScript_1 = require("./JavaScript");
const Converters_1 = require("../support/Converters");
const TypeUtils_1 = require("../TypeUtils");
const collection_utils_1 = require("collection-utils");
const Type_1 = require("../Type");
exports.javaScriptPropTypesOptions = {
    acronymStyle: Acronyms_1.acronymOption(Acronyms_1.AcronymStyleOptions.Pascal),
    converters: Converters_1.convertersOption(),
    moduleSystem: new RendererOptions_1.EnumOption("module-system", "Which module system to use", [
        ["common-js", false],
        ["es6", true],
    ], "es6"),
};
class JavaScriptPropTypesTargetLanguage extends TargetLanguage_1.TargetLanguage {
    getOptions() {
        return [exports.javaScriptPropTypesOptions.acronymStyle, exports.javaScriptPropTypesOptions.converters];
    }
    constructor(displayName = "JavaScript PropTypes", names = ["javascript-prop-types"], extension = "js") {
        super(displayName, names, extension);
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new JavaScriptPropTypesRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.javaScriptPropTypesOptions, untypedOptionValues));
    }
}
exports.JavaScriptPropTypesTargetLanguage = JavaScriptPropTypesTargetLanguage;
const identityNamingFunction = Naming_1.funPrefixNamer("properties", (s) => s);
class JavaScriptPropTypesRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _jsOptions) {
        super(targetLanguage, renderContext);
        this._jsOptions = _jsOptions;
    }
    nameStyle(original, upper) {
        const acronyms = Acronyms_1.acronymStyle(this._jsOptions.acronymStyle);
        const words = __1.splitIntoWords(original);
        return __1.combineWords(words, JavaScript_1.legalizeName, upper ? __1.firstUpperWordStyle : Strings_1.allLowerWordStyle, __1.firstUpperWordStyle, upper ? (s) => __1.capitalize(acronyms(s)) : Strings_1.allLowerWordStyle, acronyms, "", JavaScriptUnicodeMaps_1.isES3IdentifierStart);
    }
    makeNamedTypeNamer() {
        return Naming_1.funPrefixNamer("types", (s) => this.nameStyle(s, true));
    }
    namerForObjectProperty() {
        return identityNamingFunction;
    }
    makeUnionMemberNamer() {
        return null;
    }
    makeEnumCaseNamer() {
        return Naming_1.funPrefixNamer("enum-cases", (s) => this.nameStyle(s, false));
    }
    namedTypeToNameForTopLevel(type) {
        return TypeUtils_1.directlyReachableSingleNamedType(type);
    }
    makeNameForProperty(c, className, p, jsonName, _assignedName) {
        // Ignore the assigned name
        return super.makeNameForProperty(c, className, p, jsonName, undefined);
    }
    typeMapTypeFor(t, required = true) {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return ["_", this.nameForNamedType(t)];
        }
        const match = __1.matchType(t, (_anyType) => "PropTypes.any", (_nullType) => "PropTypes.any", (_boolType) => "PropTypes.bool", (_integerType) => "PropTypes.number", (_doubleType) => "PropTypes.number", (_stringType) => "PropTypes.string", (arrayType) => ["PropTypes.arrayOf(", this.typeMapTypeFor(arrayType.items, false), ")"], (_classType) => __1.panic("Should already be handled."), (_mapType) => "PropTypes.object", (_enumType) => __1.panic("Should already be handled."), (unionType) => {
            const children = Array.from(unionType.getChildren()).map((type) => this.typeMapTypeFor(type, false));
            return ["PropTypes.oneOfType([", ...collection_utils_1.arrayIntercalate(", ", children), "])"];
        }, (_transformedStringType) => {
            return "PropTypes.string";
        });
        if (required) {
            return [match];
        }
        return match;
    }
    typeMapTypeForProperty(p) {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["PropType.any"];
    }
    importStatement(lhs, moduleName) {
        if (this._jsOptions.moduleSystem) {
            return ["import ", lhs, " from ", moduleName, ";"];
        }
        else {
            return ["const ", lhs, " = require(", moduleName, ");"];
        }
    }
    emitUsageComments() {
        // FIXME: Use the correct type name
        this.emitCommentLines([
            "Example usage:",
            "",
            this.importStatement("{ MyShape }", "./myShape.js"),
            "",
            "class MyComponent extends React.Component {",
            "  //",
            "}",
            "",
            "MyComponent.propTypes = {",
            "  input: MyShape",
            "};",
        ], "// ");
    }
    emitBlock(source, end, emit) {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }
    emitImports() {
        this.ensureBlankLine();
        this.emitLine(this.importStatement("PropTypes", '"prop-types"'));
    }
    emitExport(name, value) {
        if (this._jsOptions.moduleSystem) {
            this.emitLine("export const ", name, " = ", value, ";");
        }
        else {
            this.emitLine("module.exports = exports = { ", name, ": ", value, " };");
        }
    }
    emitTypes() {
        this.ensureBlankLine();
        this.forEachObject("none", (_type, name) => {
            this.emitLine("let _", name, ";");
        });
        this.forEachEnum("none", (enumType, enumName) => {
            const options = [];
            this.forEachEnumCase(enumType, "none", (name, _jsonName, _position) => {
                options.push("'");
                options.push(name);
                options.push("'");
                options.push(", ");
            });
            options.pop();
            this.emitLine(["const _", enumName, " = PropTypes.oneOfType([", ...options, "]);"]);
        });
        const order = [];
        const mapKey = [];
        const mapValue = [];
        this.forEachObject("none", (type, name) => {
            mapKey.push(name);
            mapValue.push(this.gatherSource(() => this.emitObject(name, type)));
        });
        // order these
        mapKey.forEach((_, index) => {
            // assume first
            let ordinal = 0;
            // pull out all names
            const source = mapValue[index];
            const names = source.filter((value) => value);
            // must be behind all these names
            for (let i = 0; i < names.length; i++) {
                const depName = names[i];
                // find this name's ordinal, if it has already been added
                for (let j = 0; j < order.length; j++) {
                    const depIndex = order[j];
                    if (mapKey[depIndex] === depName) {
                        // this is the index of the dependency, so make sure we come after it
                        ordinal = Math.max(ordinal, depIndex + 1);
                    }
                }
            }
            // insert index
            order.splice(ordinal, 0, index);
        });
        // now emit ordered source
        order.forEach((i) => this.emitGatheredSource(mapValue[i]));
        // now emit top levels
        this.forEachTopLevel("none", (type, name) => {
            if (type instanceof Type_1.PrimitiveType) {
                this.ensureBlankLine();
                this.emitExport(name, this.typeMapTypeFor(type));
            }
            else {
                if (type.kind === "array") {
                    this.ensureBlankLine();
                    this.emitExport(name, ["PropTypes.arrayOf(", this.typeMapTypeFor(type.items), ")"]);
                }
                else {
                    this.ensureBlankLine();
                    this.emitExport(name, ["_", name]);
                }
            }
        });
    }
    emitObject(name, t) {
        this.ensureBlankLine();
        this.emitLine("_", name, " = PropTypes.shape({");
        this.indent(() => {
            this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                this.emitLine(`"${Strings_1.utf16StringEscape(jsonName)}"`, ": ", this.typeMapTypeForProperty(property), ",");
            });
        });
        this.emitLine("});");
    }
    emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else {
            this.emitUsageComments();
        }
        this.emitImports();
        this.emitTypes();
    }
}
exports.JavaScriptPropTypesRenderer = JavaScriptPropTypesRenderer;
