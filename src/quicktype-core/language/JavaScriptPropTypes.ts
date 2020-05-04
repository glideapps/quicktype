import {TargetLanguage} from "../TargetLanguage";
import {getOptionValues, Option, OptionValues} from "../RendererOptions";
import {RenderContext} from "../Renderer";
import {ConvenienceRenderer} from "../ConvenienceRenderer";
import {funPrefixNamer, Name, Namer} from "../Naming";
import {acronymOption, acronymStyle, AcronymStyleOptions} from "../support/Acronyms";
import {
    capitalize,
    ClassProperty,
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
        const name = combineWords(
            words,
            legalizeName,
            upper ? firstUpperWordStyle : allLowerWordStyle,
            firstUpperWordStyle,
            upper ? s => capitalize(acronyms(s)) : allLowerWordStyle,
            acronyms,
            "",
            isES3IdentifierStart
        );

        return name;
    }

    typeMapTypeFor(t: Type, required: boolean = true): Sourcelike {
        if (["class", "object"].indexOf(t.kind) >= 0) {
            return this.nameForNamedType(t);
        }

        const format = (val: Sourcelike) => required ? `${val}.isRequired` : val;

        return format(matchType<Sourcelike>(
            t,
            _anyType => `PropTypes.any`,
            _nullType => panic('There is no null equivalent in PropTypes.'),
            _boolType => 'PropTypes.bool',
            _integerType => 'PropTypes.number',
            _doubleType => 'PropTypes.number',
            _stringType => 'PropTypes.string',
            arrayType => `PropTypes.arrayOf(${this.typeMapTypeFor(arrayType.items, false)})`,
            _classType => panic('Should already be handled.'),
            _mapType => 'PropTypes.object',
            enumType => `PropTypes.oneOf(['${Array.from(enumType.cases.values()).join("' ,'")}'])`,
            unionType => {
                const children = Array.from(unionType.getChildren()).map((type: Type) => this.typeMapTypeFor(type, false));
                return `PropTypes.oneOfType([${children.join(',')}])`
            },
            _transformedStringType => {
                return 'PropTypes.string';
            }
        ));
    }

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["u(undefined, ", typeMap, ")"];
    }

    protected emitUsageComments(): void {
        this.emitLine('// For use with proptypes.')
    }

    protected emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void) {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }

    protected emitImports(): void {
        this.ensureBlankLine();
        this.emitLine('import PropTypes from \'prop-types\';')
    }

    protected emitTypes(): void {
        this.ensureBlankLine();

        this.forEachObject("none", (t: ObjectType, name: Name) => {
            this.emitLine('export const ', name, ' = PropTypes.shape({')
            this.indent(() => {
                this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                    this.emitLine(
                        utf16StringEscape(jsonName),
                        ': ',
                        this.typeMapTypeForProperty(property),
                        ',');
                });
            });
            this.emitLine('});');
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

    protected makeEnumCaseNamer(): Namer | null {
        return funPrefixNamer("enum-cases", s => this.nameStyle(s, true));
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", s => this.nameStyle(s, true));
    }

    protected makeUnionMemberNamer(): Namer | null {
        return null;
    }

    protected namerForObjectProperty(): Namer | null {
        return identityNamingFunction;
    }
}
