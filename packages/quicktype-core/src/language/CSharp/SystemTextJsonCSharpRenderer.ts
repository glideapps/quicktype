import { arrayIntercalate } from "collection-utils";

import { type ForbiddenWordsInfo, inferredNameOrder } from "../../ConvenienceRenderer";
import { DependencyName, type Name, SimpleName } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, modifySource } from "../../Source";
import { camelCase, utf16StringEscape } from "../../support/Strings";
import { defined, panic } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import {
    ArrayDecodingTransformer,
    ArrayEncodingTransformer,
    ChoiceTransformer,
    DecodingChoiceTransformer,
    DecodingTransformer,
    EncodingTransformer,
    MinMaxLengthCheckTransformer,
    MinMaxValueTransformer,
    ParseStringTransformer,
    StringMatchTransformer,
    StringProducerTransformer,
    StringifyTransformer,
    type Transformation,
    type Transformer,
    UnionInstantiationTransformer,
    UnionMemberMatchTransformer,
    followTargetType,
    transformationForType
} from "../../Transformers";
import { ArrayType, type ClassProperty, ClassType, EnumType, type Type, UnionType } from "../../Type";
import { nullableFromUnion } from "../../TypeUtils";

import { CSharpRenderer } from "./CSharpRenderer";
import { type systemTextJsonCSharpOptions } from "./language";
import {
    AccessModifier,
    alwaysApplyTransformation,
    denseJsonPropertyName,
    denseNullValueHandlingEnumName,
    isValueType,
    namingFunction
} from "./utils";

export class SystemTextJsonCSharpRenderer extends CSharpRenderer {
    private readonly _enumExtensionsNames = new Map<Name, Name>();

    private readonly _needHelpers: boolean;

    private readonly _needAttributes: boolean;

    private readonly _needNamespaces: boolean;

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof systemTextJsonCSharpOptions>
    ) {
        super(targetLanguage, renderContext, _options);
        this._needHelpers = _options.features.helpers;
        this._needAttributes = _options.features.attributes;
        this._needNamespaces = _options.features.namespaces;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        const forbidden = [
            "Converter",
            "JsonConverter",
            "JsonSerializer",
            "JsonWriter",
            "JsonToken",
            "Serialize",
            "JsonSerializerOptions",
            // "Newtonsoft",
            // "MetadataPropertyHandling",
            // "DateParseHandling",
            "FromJson",
            "Required"
        ];
        if (this._options.dense) {
            forbidden.push("J", "R", "N");
        }

        if (this._options.baseclass !== undefined) {
            forbidden.push(this._options.baseclass);
        }

        return super.forbiddenNamesForGlobalNamespace().concat(forbidden);
    }

    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo {
        const result = super.forbiddenForObjectProperties(c, className);
        result.names = result.names.concat(["ToJson", "FromJson", "Required"]);
        return result;
    }

    protected makeNameForTransformation(xf: Transformation, typeName: Name | undefined): Name {
        if (typeName === undefined) {
            let xfer = xf.transformer;
            if (xfer instanceof DecodingTransformer && xfer.consumer !== undefined) {
                xfer = xfer.consumer;
            }

            return new SimpleName([`${xfer.kind}_converter`], namingFunction, inferredNameOrder + 30);
        }

        return new DependencyName(namingFunction, typeName.order + 30, lookup => `${lookup(typeName)}_converter`);
    }

    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[] {
        if (!(t instanceof EnumType)) return [];

        const extensionsName = new DependencyName(
            namingFunction,
            name.order + 30,
            lookup => `${lookup(name)}_extensions`
        );
        this._enumExtensionsNames.set(name, extensionsName);
        return [extensionsName];
    }

    protected emitUsings(): void {
        // FIXME: We need System.Collections.Generic whenever we have maps or use List.
        if (!this._needAttributes && !this._needHelpers) return;

        super.emitUsings();
        this.ensureBlankLine();

        for (const ns of ["System.Text.Json", "System.Text.Json.Serialization", "System.Globalization"]) {
            this.emitUsing(ns);
        }

        if (this._options.dense) {
            this.emitUsing([denseJsonPropertyName, " = System.Text.Json.Serialization.JsonPropertyNameAttribute"]);
            // this.emitUsing([denseRequiredEnumName, " = Newtonsoft.Json.Required"]);
            this.emitUsing([denseNullValueHandlingEnumName, " = System.Text.Json.Serialization.JsonIgnoreCondition"]);
        }

        if (this._options.baseclass === "EntityData") {
            this.emitUsing("Microsoft.Azure.Mobile.Server");
        }
    }

    protected baseclassForType(_t: Type): Sourcelike | undefined {
        return this._options.baseclass;
    }

    protected emitDefaultFollowingComments(): void {
        if (!this._needHelpers) return;

        this.emitLine("#pragma warning restore CS8618");
        this.emitLine("#pragma warning restore CS8601");
        this.emitLine("#pragma warning restore CS8603");
    }

    protected emitDefaultLeadingComments(): void {
        if (!this._needHelpers) return;

        this.emitLine("// <auto-generated />");
        this.emitLine("//");
        this.emitLine(
            "// To parse this JSON data, add NuGet 'System.Text.Json' then do",
            this.topLevels.size === 1 ? "" : " one of these",
            ":"
        );
        this.emitLine("//");
        this.emitLine("//    using ", this._options.namespace, ";");
        this.emitLine("//");
        this.forEachTopLevel("none", (t, topLevelName) => {
            let rhs: Sourcelike;
            if (t instanceof EnumType) {
                rhs = ["JsonSerializer.Deserialize<", topLevelName, ">(jsonString)"];
            } else {
                rhs = [topLevelName, ".FromJson(jsonString)"];
            }

            this.emitLine("//    var ", modifySource(camelCase, topLevelName), " = ", rhs, ";");
        });

        // fix: should this be an option? Or respond to an existing option?
        this.emitLine("#nullable enable");
        this.emitLine("#pragma warning disable CS8618");
        this.emitLine("#pragma warning disable CS8601");
        this.emitLine("#pragma warning disable CS8603");
    }

    private converterForType(t: Type): Name | undefined {
        let xf = transformationForType(t);

        if (xf === undefined && t instanceof UnionType) {
            const maybeNullable = nullableFromUnion(t);
            if (maybeNullable !== null) {
                t = maybeNullable;
                xf = transformationForType(t);
            }
        }

        if (xf === undefined) return undefined;

        if (alwaysApplyTransformation(xf)) return undefined;

        return defined(this.nameForTransformation(t));
    }

    protected attributesForProperty(
        property: ClassProperty,
        _name: Name,
        _c: ClassType,
        jsonName: string
    ): Sourcelike[] | undefined {
        if (!this._needAttributes) return undefined;

        const attributes: Sourcelike[] = [];

        const jsonPropertyName = this._options.dense ? denseJsonPropertyName : "JsonPropertyName";
        const escapedName = utf16StringEscape(jsonName);
        const isNullable = followTargetType(property.type).isNullable;
        const isOptional = property.isOptional;

        if (!isOptional) {
            attributes.push(["[", "JsonRequired", "]"]);
        } else if (isOptional && !isNullable) {
            attributes.push(["[", "JsonIgnore", "(Condition = JsonIgnoreCondition.WhenWritingNull)]"]);
        }


        // const requiredClass = this._options.dense ? "R" : "Required";
        // const nullValueHandlingClass = this._options.dense ? "N" : "NullValueHandling";
        // const nullValueHandling = isOptional && !isNullable ? [", NullValueHandling = ", nullValueHandlingClass, ".Ignore"] : [];
        // let required: Sourcelike;
        // if (!this._options.checkRequired || (isOptional && isNullable)) {
        //     required = [nullValueHandling];
        // } else if (isOptional && !isNullable) {
        //     required = [", Required = ", requiredClass, ".DisallowNull", nullValueHandling];
        // } else if (!isOptional && isNullable) {
        //     required = [", Required = ", requiredClass, ".AllowNull"];
        // } else {
        //     required = [", Required = ", requiredClass, ".Always", nullValueHandling];
        // }

        attributes.push(["[", jsonPropertyName, '("', escapedName, '")]']);

        const converter = this.converterForType(property.type);
        if (converter !== undefined) {
            attributes.push(["[JsonConverter(typeof(", converter, "))]"]);
        }

        return attributes;
    }

    protected blankLinesBetweenAttributes(): boolean {
        return this._needAttributes && !this._options.dense;
    }

    // The "this" type can't be `dynamic`, so we have to force it to `object`.
    private topLevelResultType(t: Type): Sourcelike {
        return t.kind === "any" || t.kind === "none" ? "object" : this.csType(t);
    }

    private emitFromJsonForTopLevel(t: Type, name: Name): void {
        if (t instanceof EnumType) return;

        let partial: string;
        let typeKind: string;
        const definedType = this.namedTypeToNameForTopLevel(t);
        if (definedType !== undefined) {
            partial = "partial ";
            typeKind = definedType instanceof ClassType ? "class" : "struct";
        } else {
            partial = "";
            typeKind = "class";
        }

        const csType = this.topLevelResultType(t);
        this.emitType(undefined, AccessModifier.Public, [partial, typeKind], name, this.baseclassForType(t), () => {
            // FIXME: Make FromJson a Named
            this.emitExpressionMember(
                ["public static ", csType, " FromJson(string json)"],
                ["JsonSerializer.Deserialize<", csType, ">(json, ", this._options.namespace, ".Converter.Settings)"]
            );
        });
    }

    private emitDecoderSwitch(emitBody: () => void): void {
        this.emitLine("switch (reader.TokenType)");
        this.emitBlock(emitBody);
    }

    private emitTokenCase(tokenType: string): void {
        this.emitLine("case JsonTokenType.", tokenType, ":");
    }

    private emitThrow(message: Sourcelike): void {
        this.emitLine("throw new Exception(", message, ");");
    }

    private deserializeTypeCode(typeName: Sourcelike): Sourcelike {
        switch (typeName) {
            case "bool":
                return ["reader.GetBoolean()"];
            case "long":
                return ["reader.GetInt64()"];
            case "decimal":
                return ["reader.GetDecimal()"];
            case "double":
                return ["reader.GetDouble()"];
            case "string":
                return ["reader.GetString()"];
            default:
                return ["JsonSerializer.Deserialize<", typeName, ">(ref reader, options)"];
        }
    }

    private serializeValueCode(value: Sourcelike): Sourcelike {
        if (value !== "null") return ["JsonSerializer.Serialize(writer, ", value, ", options)"];
        else return ["writer.WriteNullValue()"];
    }

    private emitSerializeClass(): void {
        // FIXME: Make Serialize a Named
        this.emitType(undefined, AccessModifier.Public, "static class", "Serialize", undefined, () => {
            // Sometimes multiple top-levels will resolve to the same type, so we have to take care
            // not to emit more than one extension method for the same type.
            const seenTypes = new Set<Type>();
            this.forEachTopLevel("none", t => {
                // FIXME: Make ToJson a Named
                if (!seenTypes.has(t)) {
                    seenTypes.add(t);
                    this.emitExpressionMember(
                        ["public static string ToJson(this ", this.topLevelResultType(t), " self)"],
                        ["JsonSerializer.Serialize(self, ", this._options.namespace, ".Converter.Settings)"]
                    );
                }
            });
        });
    }

    private emitCanConvert(expr: Sourcelike): void {
        this.emitExpressionMember("public override bool CanConvert(Type t)", expr);
    }

    private emitReadJson(emitBody: () => void, csType: Sourcelike): void {
        this.emitLine(
            "public override ",
            csType,
            " Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)"
        );
        this.emitBlock(emitBody);
    }

    private emitWriteJson(variable: string, emitBody: () => void, csType: Sourcelike): void {
        this.emitLine(
            "public override void Write(Utf8JsonWriter writer, ",
            csType,
            " ",
            variable,
            ", JsonSerializerOptions options)"
        );
        this.emitBlock(emitBody);
    }

    private converterObject(converterName: Name): Sourcelike {
        // FIXME: Get a singleton
        return [converterName, ".Singleton"];
    }

    private emitConverterClass(): void {
        // FIXME: Make Converter a Named
        const converterName: Sourcelike = ["Converter"];
        this.emitType(undefined, AccessModifier.Internal, "static class", converterName, undefined, () => {
            // Do not use .Web as defaults. That turns on caseInsensitive property names and will fail the keywords test.
            this.emitLine(
                "public static readonly JsonSerializerOptions Settings = new(JsonSerializerDefaults.General)"
            );
            this.emitBlock(() => {
                // this.emitLine("MetadataPropertyHandling = MetadataPropertyHandling.Ignore,");
                // this.emitLine("DateParseHandling = DateParseHandling.None,");
                this.emitLine("Converters =");
                this.emitLine("{");
                this.indent(() => {
                    for (const [t, converter] of this.typesWithNamedTransformations) {
                        if (alwaysApplyTransformation(defined(transformationForType(t)))) {
                            this.emitLine(this.converterObject(converter), ",");
                        }
                    }

                    this.emitLine("new DateOnlyConverter(),");
                    this.emitLine("new TimeOnlyConverter(),");
                    this.emitLine("IsoDateTimeOffsetConverter.Singleton");
                    // this.emitLine("new IsoDateTimeConverter { DateTimeStyles = DateTimeStyles.AssumeUniversal }");
                });
                this.emitLine("},");
            }, true);
        });
    }

    private emitDecoderTransformerCase(
        tokenCases: string[],
        variableName: string,
        xfer: Transformer | undefined,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): void {
        if (xfer === undefined) return;

        for (const tokenCase of tokenCases) {
            this.emitTokenCase(tokenCase);
        }

        this.indent(() => {
            const allHandled = this.emitDecodeTransformer(xfer, targetType, emitFinish, variableName);
            if (!allHandled) {
                this.emitLine("break;");
            }
        });
    }

    private emitConsume(
        value: Sourcelike,
        consumer: Transformer | undefined,
        targetType: Type,
        emitFinish: (variableName: Sourcelike) => void
    ): boolean {
        if (consumer === undefined) {
            emitFinish(value);
            return true;
        } else {
            return this.emitTransformer(value, consumer, targetType, emitFinish);
        }
    }

    private emitDecodeTransformer(
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void,
        variableName = "value"
    ): boolean {
        if (xfer instanceof DecodingTransformer) {
            const source = xfer.sourceType;
            const converter = this.converterForType(targetType);
            if (converter !== undefined) {
                const typeSource = this.csType(targetType);
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine(
                    "var ",
                    variableName,
                    " = (",
                    typeSource,
                    ")converter.ReadJson(reader, typeof(",
                    typeSource,
                    "), null, serializer);"
                );
            } else if (source.kind !== "null") {
                let output = targetType.kind === "double" ? targetType : source;
                this.emitLine("var ", variableName, " = ", this.deserializeTypeCode(this.csType(output)), ";");
            }

            return this.emitConsume(variableName, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof ArrayDecodingTransformer) {
            // FIXME: Consume StartArray
            if (!(targetType instanceof ArrayType)) {
                return panic("Array decoding must produce an array type");
            }

            // FIXME: handle EOF
            this.emitLine("reader.Read();");
            this.emitLine("var ", variableName, " = new List<", this.csType(targetType.items), ">();");
            this.emitLine("while (reader.TokenType != JsonToken.EndArray)");
            this.emitBlock(() => {
                this.emitDecodeTransformer(
                    xfer.itemTransformer,
                    xfer.itemTargetType,
                    v => this.emitLine(variableName, ".Add(", v, ");"),
                    "arrayItem"
                );
                // FIXME: handle EOF
                this.emitLine("reader.Read();");
            });
            let result: Sourcelike = variableName;
            if (!this._options.useList) {
                result = [result, ".ToArray()"];
            }

            emitFinish(result);
            return true;
        } else if (xfer instanceof DecodingChoiceTransformer) {
            this.emitDecoderSwitch(() => {
                const nullTransformer = xfer.nullTransformer;
                if (nullTransformer !== undefined) {
                    this.emitTokenCase("Null");
                    this.indent(() => {
                        const allHandled = this.emitDecodeTransformer(nullTransformer, targetType, emitFinish, "null");
                        if (!allHandled) {
                            this.emitLine("break");
                        }
                    });
                }

                this.emitDecoderTransformerCase(
                    ["Number"],
                    "integerValue",
                    xfer.integerTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["Number"],
                    // xfer.integerTransformer === undefined ? ["Integer", "Float"] : ["Float"],
                    "doubleValue",
                    xfer.doubleTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["True", "False"],
                    "boolValue",
                    xfer.boolTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    // ["String", "Date"],
                    ["String"],
                    "stringValue",
                    xfer.stringTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartObject"],
                    "objectValue",
                    xfer.objectTransformer,
                    targetType,
                    emitFinish
                );
                this.emitDecoderTransformerCase(
                    ["StartArray"],
                    "arrayValue",
                    xfer.arrayTransformer,
                    targetType,
                    emitFinish
                );
            });
            return false;
        } else {
            return panic("Unknown transformer");
        }
    }

    private stringCaseValue(t: Type, stringCase: string): Sourcelike {
        if (t.kind === "string") {
            return ['"', utf16StringEscape(stringCase), '"'];
        } else if (t instanceof EnumType) {
            return [this.nameForNamedType(t), ".", this.nameForEnumCase(t, stringCase)];
        }

        return panic(`Type ${t.kind} does not have string cases`);
    }

    private emitTransformer(
        variable: Sourcelike,
        xfer: Transformer,
        targetType: Type,
        emitFinish: (value: Sourcelike) => void
    ): boolean {
        function directTargetType(continuation: Transformer | undefined): Type {
            if (continuation === undefined) {
                return targetType;
            }

            return followTargetType(continuation.sourceType);
        }

        if (xfer instanceof ChoiceTransformer) {
            const caseXfers = xfer.transformers;
            if (caseXfers.length > 1 && caseXfers.every(caseXfer => caseXfer instanceof StringMatchTransformer)) {
                this.emitLine("switch (", variable, ")");
                this.emitBlock(() => {
                    for (const caseXfer of caseXfers) {
                        const matchXfer = caseXfer as StringMatchTransformer;
                        const value = this.stringCaseValue(
                            followTargetType(matchXfer.sourceType),
                            matchXfer.stringCase
                        );
                        this.emitLine("case ", value, ":");
                        this.indent(() => {
                            const allDone = this.emitTransformer(
                                variable,
                                matchXfer.transformer,
                                targetType,
                                emitFinish
                            );
                            if (!allDone) {
                                this.emitLine("break;");
                            }
                        });
                    }
                });
                // FIXME: Can we check for exhaustiveness?  For enums it should be easy.
                return false;
            } else {
                for (const caseXfer of caseXfers) {
                    this.emitTransformer(variable, caseXfer, targetType, emitFinish);
                }
            }
        } else if (xfer instanceof UnionMemberMatchTransformer) {
            const memberType = xfer.memberType;
            const maybeNullable = nullableFromUnion(xfer.sourceType);
            let test: Sourcelike;
            let member: Sourcelike;
            if (maybeNullable !== null) {
                if (memberType.kind === "null") {
                    test = [variable, " == null"];
                    member = "null";
                } else {
                    test = [variable, " != null"];
                    member = variable;
                }
            } else if (memberType.kind === "null") {
                test = [variable, ".IsNull"];
                member = "null";
            } else {
                const memberName = this.nameForUnionMember(xfer.sourceType, memberType);
                member = [variable, ".", memberName];
                test = [member, " != null"];
            }

            if (memberType.kind !== "null" && isValueType(memberType)) {
                member = [member, ".Value"];
            }

            this.emitLine("if (", test, ")");
            this.emitBlock(() => this.emitTransformer(member, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof StringMatchTransformer) {
            const value = this.stringCaseValue(followTargetType(xfer.sourceType), xfer.stringCase);
            this.emitLine("if (", variable, " == ", value, ")");
            this.emitBlock(() => this.emitTransformer(variable, xfer.transformer, targetType, emitFinish));
        } else if (xfer instanceof EncodingTransformer) {
            const converter = this.converterForType(xfer.sourceType);
            if (converter !== undefined) {
                this.emitLine("var converter = ", this.converterObject(converter), ";");
                this.emitLine("converter.WriteJson(writer, ", variable, ", serializer);");
            } else {
                this.emitLine(this.serializeValueCode(variable), ";");
            }

            emitFinish([]);
            return true;
        } else if (xfer instanceof ArrayEncodingTransformer) {
            this.emitLine("writer.WriteStartArray();");
            const itemVariable = "arrayItem";
            this.emitLine("foreach (var ", itemVariable, " in ", variable, ")");
            this.emitBlock(() => {
                this.emitTransformer(itemVariable, xfer.itemTransformer, xfer.itemTargetType, () => {
                    return;
                });
            });
            this.emitLine("writer.WriteEndArray();");
            emitFinish([]);
            return true;
        } else if (xfer instanceof ParseStringTransformer) {
            const immediateTargetType = xfer.consumer === undefined ? targetType : xfer.consumer.sourceType;
            switch (immediateTargetType.kind) {
                case "date-time":
                    this.emitLine("DateTimeOffset dt;");
                    this.emitLine("if (DateTimeOffset.TryParse(", variable, ", out dt))");
                    this.emitBlock(() => this.emitConsume("dt", xfer.consumer, targetType, emitFinish));
                    break;
                case "uuid":
                    this.emitLine("Guid guid;");
                    this.emitLine("if (Guid.TryParse(", variable, ", out guid))");
                    this.emitBlock(() => this.emitConsume("guid", xfer.consumer, targetType, emitFinish));
                    break;
                case "uri":
                    this.emitLine("try");
                    this.emitBlock(() => {
                        // this.emitLine("var uri = new Uri(", variable, ");");
                        // The default value about:blank should never happen, but this way we avoid a null reference warning.
                        this.emitLine('var uri = new Uri("about:blank");');
                        this.emitLine("if (!string.IsNullOrEmpty(stringValue))");
                        this.emitBlock(() => {
                            this.emitLine("uri = new Uri(", variable, ");");
                        });
                        this.emitConsume("uri", xfer.consumer, targetType, emitFinish);
                    });
                    this.emitLine("catch (UriFormatException) {}");
                    break;
                case "integer":
                    this.emitLine("long l;");
                    this.emitLine("if (Int64.TryParse(", variable, ", out l))");
                    this.emitBlock(() => this.emitConsume("l", xfer.consumer, targetType, emitFinish));
                    break;
                case "bool":
                    this.emitLine("bool b;");
                    this.emitLine("if (Boolean.TryParse(", variable, ", out b))");
                    this.emitBlock(() => this.emitConsume("b", xfer.consumer, targetType, emitFinish));
                    break;
                default:
                    return panic(`Parsing string to ${immediateTargetType.kind} not supported`);
            }
        } else if (xfer instanceof StringifyTransformer) {
            switch (xfer.sourceType.kind) {
                case "date-time":
                    return this.emitConsume(
                        [variable, '.ToString("o", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "uuid":
                    return this.emitConsume(
                        [variable, '.ToString("D", System.Globalization.CultureInfo.InvariantCulture)'],
                        xfer.consumer,
                        targetType,
                        emitFinish
                    );
                case "integer":
                case "uri":
                    return this.emitConsume([variable, ".ToString()"], xfer.consumer, targetType, emitFinish);
                case "bool":
                    this.emitLine("var boolString = ", variable, ' ? "true" : "false";');
                    return this.emitConsume("boolString", xfer.consumer, targetType, emitFinish);
                default:
                    return panic(`Stringifying ${xfer.sourceType.kind} not supported`);
            }
        } else if (xfer instanceof StringProducerTransformer) {
            const value = this.stringCaseValue(directTargetType(xfer.consumer), xfer.result);
            return this.emitConsume(value, xfer.consumer, targetType, emitFinish);
        } else if (xfer instanceof MinMaxLengthCheckTransformer) {
            const min = xfer.minLength;
            const max = xfer.maxLength;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, ".Length >= ", min.toString()]);
            }

            if (max !== undefined) {
                conditions.push([variable, ".Length <= ", max.toString()]);
            }

            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof MinMaxValueTransformer) {
            const min = xfer.minimum;
            const max = xfer.maximum;
            const conditions: Sourcelike[] = [];

            if (min !== undefined) {
                conditions.push([variable, " >= ", min.toString()]);
            }

            if (max !== undefined) {
                conditions.push([variable, " <= ", max.toString()]);
            }

            this.emitLine("if (", arrayIntercalate([" && "], conditions), ")");
            this.emitBlock(() => this.emitConsume(variable, xfer.consumer, targetType, emitFinish));
            return false;
        } else if (xfer instanceof UnionInstantiationTransformer) {
            if (!(targetType instanceof UnionType)) {
                return panic("Union instantiation transformer must produce a union type");
            }

            const maybeNullable = nullableFromUnion(targetType);
            if (maybeNullable !== null) {
                emitFinish(variable);
            } else {
                const unionName = this.nameForNamedType(targetType);
                let initializer: Sourcelike;
                if (xfer.sourceType.kind === "null") {
                    initializer = " ";
                } else {
                    const memberName = this.nameForUnionMember(targetType, xfer.sourceType);
                    initializer = [" ", memberName, " = ", variable, " "];
                }

                emitFinish(["new ", unionName, " {", initializer, "}"]);
            }

            return true;
        } else {
            return panic("Unknown transformer");
        }

        return false;
    }

    private emitTransformation(converterName: Name, t: Type): void {
        const xf = defined(transformationForType(t));
        const reverse = xf.reverse;
        const targetType = xf.targetType;
        const xfer = xf.transformer;
        const csType = this.csType(targetType);
        // const haveNullable = isValueType(targetType);

        // if (haveNullable) {
        //     converterName = ['Nullable', converterName];
        //     csType = [csType, "?"];
        // }
        this.emitType(
            undefined,
            AccessModifier.Internal,
            "class",
            converterName,
            ["JsonConverter<", csType, ">"],
            () => {
                let canConvertExpr: Sourcelike = ["t == typeof(", csType, ")"];
                this.emitCanConvert(canConvertExpr);
                this.ensureBlankLine();
                this.emitReadJson(() => {
                    // FIXME: It's unsatisfying that we need this.  The reason is that we not
                    // only match T, but also T?.  If we didn't, then the T in T? would not be
                    // deserialized with our converter but with the default one.  Can we check
                    // whether the type is a nullable?
                    // FIXME: This could duplicate one of the cases handled below in
                    // `emitDecodeTransformer`.
                    // if (haveNullable && !(targetType instanceof UnionType)) {
                    //     this.emitLine("if (reader.TokenType == JsonTokenType.Null) return null;");
                    // }

                    const allHandled = this.emitDecodeTransformer(xfer, targetType, v =>
                        this.emitLine("return ", v, ";")
                    );
                    if (!allHandled) {
                        this.emitThrow(['"Cannot unmarshal type ', csType, '"']);
                    }
                }, csType);
                this.ensureBlankLine();
                this.emitWriteJson(
                    "value",
                    () => {
                        // FIXME: See above.
                        // if (haveNullable && !(targetType instanceof UnionType)) {
                        //     this.emitLine("if (value == null)");
                        //     this.emitBlock(() => {
                        //         this.emitLine("writer.WriteNullValue();");
                        //         this.emitLine("return;");
                        //     });
                        // }

                        const allHandled = this.emitTransformer("value", reverse.transformer, reverse.targetType, () =>
                            this.emitLine("return;")
                        );
                        if (!allHandled) {
                            this.emitThrow(['"Cannot marshal type ', csType, '"']);
                        }
                    },
                    csType
                );
                this.ensureBlankLine();
                this.emitLine("public static readonly ", converterName, " Singleton = new ", converterName, "();");
            }
        );
    }

    protected emitRequiredHelpers(): void {
        if (this._needHelpers) {
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitFromJsonForTopLevel(t, n));
            this.ensureBlankLine();
            this.emitSerializeClass();
        }

        if (this._needHelpers || (this._needAttributes && (this.haveNamedUnions || this.haveEnums))) {
            this.ensureBlankLine();
            this.emitConverterClass();
            this.forEachTransformation("leading-and-interposing", (n, t) => this.emitTransformation(n, t));
            this.emitMultiline(`
public class DateOnlyConverter : JsonConverter<DateOnly>
{
	private readonly string serializationFormat;
	public DateOnlyConverter() : this(null) { }

	public DateOnlyConverter(string? serializationFormat)
	{
			this.serializationFormat = serializationFormat ?? "yyyy-MM-dd";
	}

	public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
			var value = reader.GetString();
			return DateOnly.Parse(value!);
	}

	public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
			=> writer.WriteStringValue(value.ToString(serializationFormat));
}

public class TimeOnlyConverter : JsonConverter<TimeOnly>
{
	private readonly string serializationFormat;

	public TimeOnlyConverter() : this(null) { }

	public TimeOnlyConverter(string? serializationFormat)
	{
			this.serializationFormat = serializationFormat ?? "HH:mm:ss.fff";
	}

	public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
			var value = reader.GetString();
			return TimeOnly.Parse(value!);
	}

	public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options)
			=> writer.WriteStringValue(value.ToString(serializationFormat));
}

internal class IsoDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
	public override bool CanConvert(Type t) => t == typeof(DateTimeOffset);

	private const string DefaultDateTimeFormat = "yyyy'-'MM'-'dd'T'HH':'mm':'ss.FFFFFFFK";

	private DateTimeStyles _dateTimeStyles = DateTimeStyles.RoundtripKind;
	private string? _dateTimeFormat;
	private CultureInfo? _culture;

	public DateTimeStyles DateTimeStyles
	{
			get => _dateTimeStyles;
			set => _dateTimeStyles = value;
	}

	public string? DateTimeFormat
	{
			get => _dateTimeFormat ?? string.Empty;
			set => _dateTimeFormat = (string.IsNullOrEmpty(value)) ? null : value;
	}

	public CultureInfo Culture
	{
			get => _culture ?? CultureInfo.CurrentCulture;
			set => _culture = value;
	}

	public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
	{
			string text;


			if ((_dateTimeStyles & DateTimeStyles.AdjustToUniversal) == DateTimeStyles.AdjustToUniversal
					|| (_dateTimeStyles & DateTimeStyles.AssumeUniversal) == DateTimeStyles.AssumeUniversal)
			{
					value = value.ToUniversalTime();
			}

			text = value.ToString(_dateTimeFormat ?? DefaultDateTimeFormat, Culture);

			writer.WriteStringValue(text);
	}

	public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
			string? dateText = reader.GetString();
			
			if (string.IsNullOrEmpty(dateText) == false)
			{
					if (!string.IsNullOrEmpty(_dateTimeFormat))
					{
							return DateTimeOffset.ParseExact(dateText, _dateTimeFormat, Culture, _dateTimeStyles);
					}
					else
					{
							return DateTimeOffset.Parse(dateText, Culture, _dateTimeStyles);
					}
			}
			else
			{
					return default(DateTimeOffset);
			}
	}


	public static readonly IsoDateTimeOffsetConverter Singleton = new IsoDateTimeOffsetConverter();
}`);
        }
    }

    protected needNamespace(): boolean {
        return this._needNamespaces;
    }
}
