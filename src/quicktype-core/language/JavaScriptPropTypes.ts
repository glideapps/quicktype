import {TargetLanguage} from "../TargetLanguage";
import {getOptionValues, Option, OptionValues} from "../RendererOptions";
import {RenderContext} from "../Renderer";
import {ConvenienceRenderer} from "../ConvenienceRenderer";
import {funPrefixNamer, Name, Namer} from "../Naming";
import {acronymOption, acronymStyle, AcronymStyleOptions} from "../support/Acronyms";
import {
    capitalize,
    ClassProperty, ClassType,
    combineWords,
    firstUpperWordStyle,
    matchType, ObjectType, panic,
    Sourcelike,
    splitIntoWords,
    Type
} from "..";
import {allLowerWordStyle, utf16StringEscape} from "../support/Strings";
import {isES3IdentifierStart} from "./JavaScriptUnicodeMaps";
import {legalizeName} from "./JavaScript";
import {convertersOption} from "../support/Converters";
import {directlyReachableSingleNamedType} from "../TypeUtils";
import {arrayIntercalate} from "collection-utils";

export const javaScriptPropTypesOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    converters: convertersOption()
};

export class JavaScriptPropTypesTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[] {
        return [javaScriptPropTypesOptions.acronymStyle, javaScriptPropTypesOptions.converters];
    }

    constructor(
        displayName: string = "JavaScriptPropTypes",
        names: string[] = ["javascript-prop-types"],
        extension: string = "js"
    ) {
        super(displayName, names, extension);
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): JavaScriptPropTypesRenderer {
        return new JavaScriptPropTypesRenderer(this, renderContext, getOptionValues(javaScriptPropTypesOptions, untypedOptionValues));
    }
}

const identityNamingFunction = funPrefixNamer("properties", s => s);

export class JavaScriptPropTypesRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _jsOptions: OptionValues<typeof javaScriptPropTypesOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected nameStyle(original: string, upper: boolean): string {
        const acronyms = acronymStyle(this._jsOptions.acronymStyle);
        const words = splitIntoWords(original);
        return combineWords(
            words,
            legalizeName,
            upper ? firstUpperWordStyle : allLowerWordStyle,
            firstUpperWordStyle,
            upper ? s => capitalize(acronyms(s)) : allLowerWordStyle,
            acronyms,
            "",
            isES3IdentifierStart
        );
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", s => this.nameStyle(s, true));
    }

    protected namerForObjectProperty(): Namer {
        return identityNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-cases", s => this.nameStyle(s, true));
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected makeNameForProperty(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        _assignedName: string | undefined
    ): Name | undefined {
        // Ignore the assigned name
        return super.makeNameForProperty(c, className, p, jsonName, undefined);
    }

    typeMapTypeFor(t: Type, required: boolean = true): Sourcelike {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return this.nameForNamedType(t);
        }

        console.log(required);

        return matchType<Sourcelike>(
            t,
            _anyType => "PropTypes.any",
            _nullType => "PropTypes.any",
            _boolType => "PropTypes.bool",
            _integerType => "PropTypes.number",
            _doubleType => "PropTypes.number",
            _stringType => "PropTypes.string",
            arrayType => ["PropTypes.arrayOf(", this.typeMapTypeFor(arrayType.items, false), ")"],
            _classType => panic("Should already be handled."),
            _mapType => "PropTypes.object",
            _enumType => panic("Should already be handled."),
            unionType => {
                const children = Array.from(unionType.getChildren()).map((type: Type) => this.typeMapTypeFor(type, false));
                return ["PropTypes.oneOf(", ...arrayIntercalate(", ", children), ")"];
            },
            _transformedStringType => {
                return "PropTypes.string";
            }
        );
    }

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["PropType.any"];
    }

    protected emitUsageComments(): void {
        this.emitLine("// For use with proptypes.");
    }

    protected emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void) {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }

    protected emitImports(): void {
        this.ensureBlankLine();
        this.emitLine("import PropTypes from \"prop-types\";");
    }

    protected emitTypes(): void {
        this.forEachObject("none", (t: ObjectType, name: Name) => {
            this.ensureBlankLine();
            this.emitLine("export const ", name, " = PropTypes.shape({");
            this.indent(() => {
                this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                    this.emitLine(
                        utf16StringEscape(jsonName),
                        ": ",
                        this.typeMapTypeForProperty(property),
                        ",");
                });
            });
            this.emitLine("});");
        });
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageComments();
        }

        this.emitImports();

        this.emitTypes();
    }
}
