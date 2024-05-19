import { type Name } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike } from "../../Source";
import { assertNever, panic } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { ArrayType, type ClassProperty, ClassType, EnumType, type Type, type TypeKind, UnionType } from "../../Type";
import { removeNullFromUnion } from "../../TypeUtils";

import { JavaRenderer } from "./JavaRenderer";
import { type javaOptions } from "./language";
import { stringEscape } from "./utils";


export class JacksonRenderer extends JavaRenderer {
	public constructor(
			targetLanguage: TargetLanguage,
			renderContext: RenderContext,
			options: OptionValues<typeof javaOptions>
	) {
			super(targetLanguage, renderContext, options);
	}

	protected readonly _converterKeywords: string[] = [
			"JsonProperty",
			"JsonDeserialize",
			"JsonDeserializer",
			"JsonSerialize",
			"JsonSerializer",
			"JsonParser",
			"JsonProcessingException",
			"DeserializationContext",
			"SerializerProvider"
	];

	protected emitClassAttributes(c: ClassType, _className: Name): void {
			if (c.getProperties().size === 0)
					this.emitLine("@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)");

			super.emitClassAttributes(c, _className);
	}

	protected annotationsForAccessor(
			_c: ClassType,
			_className: Name,
			_propertyName: Name,
			jsonName: string,
			p: ClassProperty,
			_isSetter: boolean
	): string[] {
			const superAnnotations = super.annotationsForAccessor(_c, _className, _propertyName, jsonName, p, _isSetter);

			const annotations: string[] = ['@JsonProperty("' + stringEscape(jsonName) + '")'];

			switch (p.type.kind) {
					case "date-time":
							this._dateTimeProvider.dateTimeJacksonAnnotations.forEach(annotation => annotations.push(annotation));
							break;
					case "date":
							this._dateTimeProvider.dateJacksonAnnotations.forEach(annotation => annotations.push(annotation));
							break;
					case "time":
							this._dateTimeProvider.timeJacksonAnnotations.forEach(annotation => annotations.push(annotation));
							break;
					default:
							break;
			}

			return [...superAnnotations, ...annotations];
	}

	protected importsForType(t: ClassType | UnionType | EnumType): string[] {
			if (t instanceof ClassType) {
					const imports = super.importsForType(t);
					imports.push("com.fasterxml.jackson.annotation.*");
					return imports;
			}

			if (t instanceof UnionType) {
					const imports = super.importsForType(t);
					imports.push(
							"java.io.IOException",
							"com.fasterxml.jackson.core.*",
							"com.fasterxml.jackson.databind.*",
							"com.fasterxml.jackson.databind.annotation.*"
					);
					if (this._options.useList) {
							imports.push("com.fasterxml.jackson.core.type.*");
					}

					return imports;
			}

			if (t instanceof EnumType) {
					const imports = super.importsForType(t);
					imports.push("com.fasterxml.jackson.annotation.*");
					return imports;
			}

			return assertNever(t);
	}

	protected emitUnionAttributes(_u: UnionType, unionName: Name): void {
			this.emitLine("@JsonDeserialize(using = ", unionName, ".Deserializer.class)");
			this.emitLine("@JsonSerialize(using = ", unionName, ".Serializer.class)");
	}

	protected emitUnionSerializer(u: UnionType, unionName: Name): void {
			const stringBasedObjects: TypeKind[] = ["uuid", "time", "date", "date-time"];

			const tokenCase = (tokenType: string): void => {
					this.emitLine("case ", tokenType, ":");
			};

			const emitNullDeserializer = (): void => {
					this.indent(() => {
							tokenCase("VALUE_NULL");
							this.indent(() => this.emitLine("break;"));
					});
			};

			const emitDeserializerCodeForStringObjects = (
					fieldName: Sourcelike,
					kind: TypeKind,
					parseFrom: string
			): void => {
					switch (kind) {
							case "date":
									this.emitLine(
											"value.",
											fieldName,
											" = ",
											this._dateTimeProvider.convertStringToDate(parseFrom),
											";"
									);

									break;
							case "time":
									this.emitLine(
											"value.",
											fieldName,
											" = ",
											this._dateTimeProvider.convertStringToTime(parseFrom),
											";"
									);

									break;
							case "date-time":
									this.emitLine(
											"value.",
											fieldName,
											" = ",
											this._dateTimeProvider.convertStringToDateTime(parseFrom),
											";"
									);
									break;
							case "uuid":
									this.emitLine("value.", fieldName, " = UUID.fromString(", parseFrom, ");");

									break;
							default:
									return panic("Requested type isnt an object!");
					}
			};

			const emitDeserializeType = (t: Type, variableFieldName = ""): void => {
					const { fieldName } = this.unionField(u, t);
					const rendered = this.javaTypeWithoutGenerics(true, t);
					if (this._options.useList && t instanceof ArrayType) {
							this.emitLine(
									"value.",
									fieldName,
									" = jsonParser.readValueAs(new TypeReference<",
									rendered,
									">() {});"
							);
					} else if (stringBasedObjects.some(stringBasedTypeKind => t.kind === stringBasedTypeKind)) {
							emitDeserializerCodeForStringObjects(fieldName, t.kind, variableFieldName);
					} else if (t.kind === "string") {
							this.emitLine("value.", fieldName, " = ", variableFieldName, ";");
					} else if (t.kind === "enum") {
							const { fieldType } = this.unionField(u, t, true);
							this.emitLine("value.", fieldName, " = ", fieldType, ".forValue(", variableFieldName, ");");
					} else {
							this.emitLine("value.", fieldName, " = jsonParser.readValueAs(", rendered, ".class);");
					}
			};

			const emitDeserializer = (tokenTypes: string[], kind: TypeKind): void => {
					const t = u.findMember(kind);
					if (t === undefined) return;

					this.indent(() => {
							for (const tokenType of tokenTypes) {
									tokenCase(tokenType);
							}

							this.indent(() => {
									emitDeserializeType(t);
									this.emitLine("break;");
							});
					});
			};

			const emitStringDeserializer = (): void => {
					const enumType = u.findMember("enum");
					const stringType = u.findMember("string");

					if (
							stringBasedObjects.every(kind => u.findMember(kind) === undefined) &&
							stringType === undefined &&
							enumType === undefined
					)
							return;

					this.indent(() => {
							tokenCase("VALUE_STRING");

							this.indent(() => {
									const fromVariable = "string";
									this.emitLine("String " + fromVariable + " = jsonParser.readValueAs(String.class);");

									stringBasedObjects.forEach(kind => {
											const type = u.findMember(kind);
											if (type !== undefined) {
													this.emitIgnoredTryCatchBlock(() => {
															emitDeserializeType(type, fromVariable);
													});
											}
									});

									if (enumType !== undefined) {
											this.emitIgnoredTryCatchBlock(() => {
													emitDeserializeType(enumType, fromVariable);
											});
									}

									// String should be the last one if exists, because it cannot fail, unlike the parsers.
									if (stringType !== undefined) {
											emitDeserializeType(stringType, fromVariable);
									}

									this.emitLine("break;");
							});
					});
			};

			const emitNumberDeserializer = (): void => {
					const integerType = u.findMember("integer");
					const doubleType = u.findMember("double");
					if (doubleType === undefined && integerType === undefined) return;

					this.indent(() => {
							tokenCase("VALUE_NUMBER_INT");
							if (integerType !== undefined) {
									this.indent(() => {
											emitDeserializeType(integerType);
											this.emitLine("break;");
									});
							}

							if (doubleType !== undefined) {
									tokenCase("VALUE_NUMBER_FLOAT");
									this.indent(() => {
											emitDeserializeType(doubleType);
											this.emitLine("break;");
									});
							}
					});
			};

			const customObjectSerializer: TypeKind[] = ["time", "date", "date-time"];

			const serializerCodeForType = (type: Type, fieldName: Sourcelike): Sourcelike => {
					switch (type.kind) {
							case "date":
									return this._dateTimeProvider.convertDateToString(fieldName);
							case "time":
									return this._dateTimeProvider.convertTimeToString(fieldName);
							case "date-time":
									return this._dateTimeProvider.convertDateTimeToString(fieldName);
							default:
									return panic("Requested type doesn't have custom serializer code!");
					}
			};

			const emitSerializeType = (t: Type): void => {
					let { fieldName } = this.unionField(u, t, true);

					this.emitBlock(["if (obj.", fieldName, " != null)"], () => {
							if (customObjectSerializer.some(customSerializerType => t.kind === customSerializerType)) {
									this.emitLine("jsonGenerator.writeObject(", serializerCodeForType(t, ["obj.", fieldName]), ");");
							} else {
									this.emitLine("jsonGenerator.writeObject(obj.", fieldName, ");");
							}

							this.emitLine("return;");
					});
			};

			const [maybeNull, nonNulls] = removeNullFromUnion(u);

			this.ensureBlankLine();
			this.emitBlock(["static class Deserializer extends JsonDeserializer<", unionName, ">"], () => {
					this.emitLine("@Override");
					this.emitBlock(
							[
									"public ",
									unionName,
									" deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException"
							],
							() => {
									this.emitLine(unionName, " value = new ", unionName, "();");
									this.emitLine("switch (jsonParser.currentToken()) {");
									if (maybeNull !== null) emitNullDeserializer();
									emitNumberDeserializer();
									emitDeserializer(["VALUE_TRUE", "VALUE_FALSE"], "bool");
									emitStringDeserializer();
									emitDeserializer(["START_ARRAY"], "array");
									emitDeserializer(["START_OBJECT"], "class");
									emitDeserializer(["START_OBJECT"], "map");
									this.indent(() =>
											this.emitLine('default: throw new IOException("Cannot deserialize ', unionName, '");')
									);
									this.emitLine("}");
									this.emitLine("return value;");
							}
					);
			});
			this.ensureBlankLine();
			this.emitBlock(["static class Serializer extends JsonSerializer<", unionName, ">"], () => {
					this.emitLine("@Override");
					this.emitBlock(
							[
									"public void serialize(",
									unionName,
									" obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException"
							],
							() => {
									for (const t of nonNulls) {
											emitSerializeType(t);
									}

									if (maybeNull !== null) {
											this.emitLine("jsonGenerator.writeNull();");
									} else {
											this.emitLine('throw new IOException("', unionName, ' must not be null");');
									}
							}
					);
			});
	}

	protected emitEnumSerializationAttributes(_e: EnumType): void {
			this.emitLine("@JsonValue");
	}

	protected emitEnumDeserializationAttributes(_e: EnumType): void {
			this.emitLine("@JsonCreator");
	}

	protected emitOffsetDateTimeConverterModule(): void {
			this.emitLine("SimpleModule module = new SimpleModule();");

			if (this._dateTimeProvider.shouldEmitDateTimeConverter) {
					this.emitLine(
							"module.addDeserializer(",
							this._dateTimeProvider.dateTimeType,
							".class, new JsonDeserializer<",
							this._dateTimeProvider.dateTimeType,
							">() {"
					);
					this.indent(() => {
							this.emitLine("@Override");
							this.emitBlock(
									[
											"public ",
											this._dateTimeProvider.dateTimeType,
											" deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
											"throws IOException, JsonProcessingException"
									],
									() => {
											this.emitLine("String value = jsonParser.getText();");
											this.emitLine("return ", this._dateTimeProvider.convertStringToDateTime("value"), ";");
									}
							);
					});
					this.emitLine("});");
			}

			if (!this._dateTimeProvider.shouldEmitTimeConverter) {
					this.emitLine(
							"module.addDeserializer(",
							this._dateTimeProvider.timeType,
							".class, new JsonDeserializer<",
							this._dateTimeProvider.timeType,
							">() {"
					);
					this.indent(() => {
							this.emitLine("@Override");
							this.emitBlock(
									[
											"public ",
											this._dateTimeProvider.timeType,
											" deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
											"throws IOException, JsonProcessingException"
									],
									() => {
											this.emitLine("String value = jsonParser.getText();");
											this.emitLine("return ", this._dateTimeProvider.convertStringToTime("value"), ";");
									}
							);
					});
					this.emitLine("});");
			}

			if (!this._dateTimeProvider.shouldEmitDateConverter) {
					this.emitLine(
							"module.addDeserializer(",
							this._dateTimeProvider.dateType,
							".class, new JsonDeserializer<",
							this._dateTimeProvider.dateType,
							">() {"
					);
					this.indent(() => {
							this.emitLine("@Override");
							this.emitBlock(
									[
											"public ",
											this._dateTimeProvider.dateType,
											" deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) ",
											"throws IOException, JsonProcessingException"
									],
									() => {
											this.emitLine("String value = jsonParser.getText();");
											this.emitLine("return ", this._dateTimeProvider.convertStringToDate("value"), ";");
									}
							);
					});
					this.emitLine("});");
			}

			this.emitLine("mapper.registerModule(module);");
	}

	protected emitConverterClass(): void {
			this.startFile(this._converterClassname);
			this.emitCommentLines([
					"To use this code, add the following Maven dependency to your project:",
					"",
					this._options.lombok ? "    org.projectlombok : lombok : 1.18.2" : "",
					"    com.fasterxml.jackson.core     : jackson-databind          : 2.9.0",
					this._options.dateTimeProvider === "java8"
							? "    com.fasterxml.jackson.datatype : jackson-datatype-jsr310   : 2.9.0"
							: "",
					"",
					"Import this package:",
					""
			]);
			this.emitLine("//     import ", this._options.packageName, ".Converter;");
			this.emitMultiline(`//
// Then you can deserialize a JSON string with
//`);
			this.forEachTopLevel("none", (t, name) => {
					this.emitLine(
							"//     ",
							this.javaType(false, t),
							" data = Converter.",
							this.decoderName(name),
							"(jsonString);"
					);
			});
			this.ensureBlankLine();
			const imports = [
					"java.io.IOException",
					"com.fasterxml.jackson.databind.*",
					"com.fasterxml.jackson.databind.module.SimpleModule",
					"com.fasterxml.jackson.core.JsonParser",
					"com.fasterxml.jackson.core.JsonProcessingException",
					"java.util.*"
			].concat(this._dateTimeProvider.converterImports);
			this.emitPackageAndImports(imports);
			this.ensureBlankLine();
			this.emitBlock(["public class Converter"], () => {
					this.emitLine("// Date-time helpers");
					this._dateTimeProvider.emitDateTimeConverters();

					this.emitLine("// Serialize/deserialize helpers");
					this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
							const topLevelTypeRendered = this.javaType(false, topLevelType);
							this.emitBlock(
									[
											"public static ",
											topLevelTypeRendered,
											" ",
											this.decoderName(topLevelName),
											"(String json) throws IOException"
									],
									() => {
											this.emitLine("return ", this.readerGetterName(topLevelName), "().readValue(json);");
									}
							);
							this.ensureBlankLine();
							this.emitBlock(
									[
											"public static String ",
											this.encoderName(topLevelName),
											"(",
											topLevelTypeRendered,
											" obj) throws JsonProcessingException"
									],
									() => {
											this.emitLine("return ", this.writerGetterName(topLevelName), "().writeValueAsString(obj);");
									}
							);
					});
					this.forEachTopLevel("leading-and-interposing", (topLevelType, topLevelName) => {
							const readerName = this.fieldOrMethodName("reader", topLevelName);
							const writerName = this.fieldOrMethodName("writer", topLevelName);
							this.emitLine("private static ObjectReader ", readerName, ";");
							this.emitLine("private static ObjectWriter ", writerName, ";");
							this.ensureBlankLine();
							this.emitBlock(
									["private static void ", this.methodName("instantiate", "Mapper", topLevelName), "()"],
									() => {
											const renderedForClass = this.javaTypeWithoutGenerics(false, topLevelType);
											this.emitLine("ObjectMapper mapper = new ObjectMapper();");
											this.emitLine("mapper.findAndRegisterModules();");
											this.emitLine("mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);");
											this.emitLine("mapper.configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);");
											this.emitOffsetDateTimeConverterModule();
											this.emitLine(readerName, " = mapper.readerFor(", renderedForClass, ".class);");
											this.emitLine(writerName, " = mapper.writerFor(", renderedForClass, ".class);");
									}
							);
							this.ensureBlankLine();
							this.emitBlock(["private static ObjectReader ", this.readerGetterName(topLevelName), "()"], () => {
									this.emitLine(
											"if (",
											readerName,
											" == null) ",
											this.methodName("instantiate", "Mapper", topLevelName),
											"();"
									);
									this.emitLine("return ", readerName, ";");
							});
							this.ensureBlankLine();
							this.emitBlock(["private static ObjectWriter ", this.writerGetterName(topLevelName), "()"], () => {
									this.emitLine(
											"if (",
											writerName,
											" == null) ",
											this.methodName("instantiate", "Mapper", topLevelName),
											"();"
									);
									this.emitLine("return ", writerName, ";");
							});
					});
			});
			this.finishFile();
	}

	protected emitSourceStructure(): void {
			this.emitConverterClass();
			super.emitSourceStructure();
	}
}
