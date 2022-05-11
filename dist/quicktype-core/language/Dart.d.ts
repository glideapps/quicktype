import { Type, EnumType, UnionType, ClassType, ClassProperty } from "../Type";
import { Sourcelike } from "../Source";
import { StringTypeMapping } from "../TypeBuilder";
import { Name, Namer, DependencyName } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { Option, BooleanOption, OptionValues, StringOption } from "../RendererOptions";
import { RenderContext } from "../Renderer";
export declare const dartOptions: {
    justTypes: BooleanOption;
    codersInClass: BooleanOption;
    methodNamesWithMap: BooleanOption;
    requiredProperties: BooleanOption;
    finalProperties: BooleanOption;
    generateCopyWith: BooleanOption;
    useFreezed: BooleanOption;
    useHive: BooleanOption;
    partName: StringOption;
};
export declare class DartTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    readonly supportsUnionsWithBothNumberTypes: boolean;
    readonly stringTypeMapping: StringTypeMapping;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): DartRenderer;
}
export declare class DartRenderer extends ConvenienceRenderer {
    private readonly _options;
    private readonly _gettersAndSettersForPropertyName;
    private _needEnumValues;
    private classCounter;
    private classPropertyCounter;
    private readonly _topLevelDependents;
    private readonly _enumValues;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _options: OptionValues<typeof dartOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): Namer;
    protected makeEnumCaseNamer(): Namer;
    protected unionNeedsName(u: UnionType): boolean;
    protected namedTypeToNameForTopLevel(type: Type): Type | undefined;
    protected readonly toJson: string;
    protected readonly fromJson: string;
    protected makeTopLevelDependencyNames(_t: Type, name: Name): DependencyName[];
    protected makeNamesForPropertyGetterAndSetter(_c: ClassType, _className: Name, _p: ClassProperty, _jsonName: string, name: Name): [Name, Name];
    protected makePropertyDependencyNames(c: ClassType, className: Name, p: ClassProperty, jsonName: string, name: Name): Name[];
    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[];
    protected emitFileHeader(): void;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    protected emitBlock(line: Sourcelike, f: () => void): void;
    protected dartType(t: Type, withIssues?: boolean): Sourcelike;
    protected mapList(itemType: Sourcelike, list: Sourcelike, mapper: Sourcelike): Sourcelike;
    protected mapMap(valueType: Sourcelike, map: Sourcelike, valueMapper: Sourcelike): Sourcelike;
    protected fromDynamicExpression(t: Type, ...dynamic: Sourcelike[]): Sourcelike;
    protected toDynamicExpression(t: Type, ...dynamic: Sourcelike[]): Sourcelike;
    protected emitClassDefinition(c: ClassType, className: Name): void;
    protected emitFreezedClassDefinition(c: ClassType, className: Name): void;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
    protected emitEnumValues(): void;
    protected emitSourceStructure(): void;
}
