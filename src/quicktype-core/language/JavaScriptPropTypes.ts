import {TargetLanguage} from "../TargetLanguage";
import {BooleanOption, getOptionValues, Option, OptionValues} from "../RendererOptions";
import {RenderContext} from "../Renderer";
import {ConvenienceRenderer} from "../ConvenienceRenderer";
import {funPrefixNamer, Namer} from "../Naming";
import {acronymOption, acronymStyle, AcronymStyleOptions} from "../support/Acronyms";
import {capitalize, combineWords, firstUpperWordStyle, Sourcelike, splitIntoWords} from "..";
import {allLowerWordStyle} from "../support/Strings";
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
        names: string[] = ["prop-types"],
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
        private readonly _jsOptions: OptionValues<typeof javaScriptOptions>
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

    protected emitUsageComments(): void {
        this.emitLine('// For use with proptypes.')
    }

    emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void) {
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

        this.forEachTopLevel("none", (_, name) => {
            this.emitBlock(`export const ${name} = {`, '};', () => {

            });
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
