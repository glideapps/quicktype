module Language.Java
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Array as A
import Data.Char.Unicode (GeneralCategory(..), generalCategory, isSpace)
import Data.Foldable (find, for_)
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Set (Set)
import Data.Set as S
import Data.String.Util (camelCase, capitalize, isLetterOrLetterNumber, legalizeCharacters, startWithLetter, stringEscape)
import Data.Tuple (Tuple(..))
import Utils (removeElement)

forbiddenNames :: Array String
forbiddenNames =
    [ "Object", "Class", "System", "Long", "Double", "Boolean", "String", "Map", "Exception", "IOException"
    , "JsonProperty", "JsonDeserialize", "JsonDeserializer", "JsonSerialize", "JsonSerializer"
    , "JsonParser", "JsonProcessingException", "DeserializationContext", "SerializerProvider"
    , "Converter"
    , "abstract", "continue", "for", "new", "switch"
    , "assert", "default", "goto", "package", "synchronized"
    , "boolean", "do", "if", "private", "this"
    , "break", "double", "implements", "protected", "throw"
    , "byte", "else", "import", "public", "throws"
    , "case", "enum", "instanceof", "return", "transient"
    , "catch", "extends", "int", "short", "try"
    , "char", "final", "interface", "static", "void"
    , "class", "finally", "long", "strictfp", "volatile"
    , "const", "float", "native", "super", "while"
    , "null"
    ]

renderer :: Renderer
renderer =
    { name: "Java"
    , aceMode: "java"
    , extension: "java"
    , doc: javaDoc
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: forbiddenNames
        , topLevelName: noForbidNamer (javaNameStyle true)
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (javaNameStyle true <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated (javaNameStyle true) "Or")
            }
        }
    }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = javaNameStyle true $ combineNames names

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    case generalCategory c of
    Just CurrencySymbol -> true
    Just ConnectorPunctuation -> true
    _ -> isLetterOrLetterNumber c

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Just DecimalNumber -> true
    Just SpacingCombiningMark -> true
    Just NonSpacingMark -> true
    Just Format -> true
    Just Control -> not $ isSpace c
    _ -> isStartCharacter c

legalize :: String -> String
legalize = legalizeCharacters isPartCharacter

javaNameStyle :: Boolean -> String -> String
javaNameStyle upper =
    legalize >>> camelCase >>> startWithLetter isStartCharacter upper

javaDoc :: Doc Unit
javaDoc = do
    renderConverter
    blank
    renderRenderItems blank Nothing renderClassDefinition (Just renderUnionDefinition)

renderUnionWithTypeRenderer :: (Boolean -> IRType -> Doc String) -> IRUnionRep -> Doc String
renderUnionWithTypeRenderer typeRenderer ur =
    case nullableFromUnion ur of
    Just x -> typeRenderer true x
    Nothing -> lookupUnionName ur

renderType :: Boolean -> IRType -> Doc String
renderType reference = case _ of
    IRNothing -> pure "Object"
    IRNull -> pure "Object"
    IRInteger -> pure $ if reference then "Long" else "long"
    IRDouble -> pure $ if reference then "Double" else "double"
    IRBool -> pure $ if reference then "Boolean" else "boolean"
    IRString -> pure "String"
    IRArray t -> do
        rendered <- renderType false t
        pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType true t
        pure $ "Map<String, " <> rendered <> ">"
    IRUnion ur -> renderUnionWithTypeRenderer renderType ur

renderTypeWithoutGenerics :: Boolean -> IRType -> Doc String
renderTypeWithoutGenerics reference = case _ of
    IRArray t -> do
        rendered <- renderTypeWithoutGenerics false t
        pure $ rendered <> "[]"
    IRMap t -> pure "Map"
    IRUnion ur -> renderUnionWithTypeRenderer renderTypeWithoutGenerics ur
    t -> renderType reference t

renderFileComment :: String -> Doc Unit
renderFileComment fileName = do
    line $ "// " <> fileName <> ".java"

renderPackageAndImports :: Array String -> Doc Unit
renderPackageAndImports imports = do
    line "package io.quicktype;"
    blank
    for_ imports \package -> do
        line $ "import " <> package <> ";"

renderFileHeader :: String -> Array String -> Doc Unit
renderFileHeader fileName imports = do
    renderFileComment fileName
    blank
    renderPackageAndImports imports
    blank

renderConverter :: Doc Unit
renderConverter = do
    renderFileComment "Converter"
    blank
    line """// To use this code, add the following Maven dependency to your project:
//
//     com.fasterxml.jackson.core : jackson-databind : 2.9.0
//
// Import this package:
//
//     import io.quicktype.Converter;
//
// Then you can deserialize a JSON string with
//"""
    forEachTopLevel_ \topLevelName topLevelType -> do
        topLevelTypeRendered <- renderType false topLevelType
        decoderName <- getDecoderName topLevelName
        line $ "//     " <> topLevelTypeRendered <> " data = Converter." <> decoderName <> "(jsonString);"
    blank
    renderPackageAndImports ["java.util.Map", "java.io.IOException", "com.fasterxml.jackson.databind.*", "com.fasterxml.jackson.core.JsonProcessingException"]
    blank
    line "public class Converter {"
    indent do
        line "// Serialize/deserialize helpers"
        forEachTopLevel_ \topLevelName topLevelType -> do
            blank
            topLevelTypeRendered <- renderType false topLevelType
            decoderName <- getDecoderName topLevelName
            line $ "public static " <> topLevelTypeRendered <> " " <> decoderName <> "(String json) throws IOException {"
            indent do
                getReaderName <- getReaderGetterName topLevelName
                line $ "return " <> getReaderName <> "().readValue(json);"
            line "}"
            blank
            encoderName <- getEncoderName topLevelName
            line $ "public static String " <> encoderName <> "(" <> topLevelTypeRendered <> " obj) throws JsonProcessingException {"
            indent do
                getWriterName <- getWriterGetterName topLevelName
                line $ "return " <> getWriterName <> "().writeValueAsString(obj);"
            line "}"
        forEachTopLevel_ \topLevelName topLevelType -> do
            readerName <- getFieldOrMethodName "reader" topLevelName
            writerName <- getFieldOrMethodName "writer" topLevelName
            instantiateName <- getMethodName "instantiate" "Mapper" topLevelName
            getReaderName <- getReaderGetterName topLevelName
            getWriterName <- getWriterGetterName topLevelName
            blank
            line $ "private static ObjectReader " <> readerName <> ";"
            line $ "private static ObjectWriter " <> writerName <> ";"
            blank
            line $ "private static void " <> instantiateName <> "() {"
            indent do
                renderedForClass <- renderTypeWithoutGenerics false topLevelType
                line "ObjectMapper mapper = new ObjectMapper();"
                line $ readerName <> " = mapper.reader(" <> renderedForClass <> ".class);"
                line $ writerName <> " = mapper.writerFor(" <> renderedForClass <> ".class);"
            line "}"
            blank
            line $ "private static ObjectReader " <> getReaderName <> "() {"
            indent do
                line $ "if (" <> readerName <> " == null) instantiateMapper();"
                line $ "return " <> readerName <> ";"
            line "}"
            blank
            line $ "private static ObjectWriter " <> getWriterName <> "() {"
            indent do
                line $ "if (" <> writerName <> " == null) instantiateMapper();"
                line $ "return " <> writerName <> ";"
            line "}"
    line "}"
    where
        getDecoderName = getFieldOrMethodName "fromJsonString"
        getEncoderName = getFieldOrMethodName "toJsonString"
        getReaderGetterName = getMethodName "get" "ObjectReader"
        getWriterGetterName = getMethodName "get" "ObjectWriter"

        getFieldOrMethodName :: String -> String -> Doc String
        getFieldOrMethodName methodName topLevelName =
            getForSingleOrMultipleTopLevels methodName (topLevelName <> capitalize methodName)
        
        getMethodName :: String -> String -> String -> Doc String
        getMethodName prefix suffix topLevelName =
            getForSingleOrMultipleTopLevels (prefix <> suffix) (prefix <> capitalize topLevelName <> suffix)

renderClassDefinition :: String -> Map String IRType -> Doc Unit
renderClassDefinition className properties = do
    renderFileHeader className ["java.util.Map", "com.fasterxml.jackson.annotation.*"]
    let propertyNames = transformPropertyNames (simpleNamer $ javaNameStyle false) (\n -> "other" <>  capitalize n) forbiddenNames properties
    when (M.isEmpty properties) do
        line "@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)"
    line $ "public class " <> className <> " {"
    indent do
        forEachProp_ properties propertyNames \_ javaName fieldName rendered -> do
            line $ "private " <> rendered <> " " <> fieldName <> ";"
        forEachProp_ properties propertyNames \pname javaName fieldName rendered -> do
            blank
            line $ "@JsonProperty(\"" <> stringEscape pname <> "\")"
            line $ "public " <> rendered <> " get" <> javaName <> "() { return " <> fieldName <> "; }"
            line $ "public void set" <> javaName <> "(" <> rendered <> " value) { this." <> fieldName <> " = value; }"
    line "}"
    where
        forEachProp_ :: Map String IRType -> Map String String -> (String -> String -> String -> String -> Doc Unit) -> Doc Unit
        forEachProp_ properties propertyNames f =
            forEachProperty_ properties propertyNames \pname ptype fieldName _ -> do
                let javaName = capitalize fieldName
                rendered <- renderType false ptype
                f pname javaName fieldName rendered

renderUnionField :: IRType -> Doc { renderedType :: String, fieldName :: String }
renderUnionField t = do
    renderedType <- renderType true t
    fieldName <- javaNameStyle false <$> (_ <> "_value") <$> getTypeNameForUnion t
    pure { renderedType, fieldName }

tokenCase :: String -> Doc Unit
tokenCase tokenType =
    line $ "case " <> tokenType <> ":"

renderNullCase :: Doc Unit
renderNullCase = do
    tokenCase "VALUE_NULL"
    indent do
        line "break;"

deserializeType :: IRType -> Doc Unit
deserializeType t = do
    { fieldName } <- renderUnionField t
    renderedType <- renderTypeWithoutGenerics true t
    line $ "value." <> fieldName <> " = jsonParser.readValueAs(" <> renderedType <> ".class);"
    line "break;"

renderPrimitiveCase :: Array String -> IRType -> Set IRType -> Doc Unit
renderPrimitiveCase tokenTypes t types =
    when (S.member t types) do
        for_ tokenTypes \tokenType ->
            tokenCase tokenType
        indent do
            deserializeType t

renderDoubleCase :: Set IRType -> Doc Unit
renderDoubleCase types =
    when (S.member IRDouble types) do
        unless (S.member IRInteger types) do
            tokenCase "VALUE_NUMBER_INT"
        tokenCase "VALUE_NUMBER_FLOAT"
        indent do
            deserializeType IRDouble

renderGenericCase :: (IRType -> Boolean) -> String -> Set IRType -> Doc Unit
renderGenericCase predicate tokenType types =
    case find predicate types of
    Nothing -> pure unit
    Just t -> do
        tokenCase tokenType
        indent do
            deserializeType t

renderUnionDefinition :: String -> IRUnionRep -> Doc Unit
renderUnionDefinition unionName unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    let nonNullTypes = unionToSet nonNullUnion
    renderFileHeader unionName ["java.io.IOException", "java.util.Map", "com.fasterxml.jackson.core.*", "com.fasterxml.jackson.databind.*", "com.fasterxml.jackson.databind.annotation.*"]
    line $ "@JsonDeserialize(using = " <> unionName <> ".Deserializer.class)"
    line $ "@JsonSerialize(using = " <> unionName <> ".Serializer.class)"
    line $ "public class " <> unionName <> " {"
    indent do
        forUnion_ nonNullUnion \t -> do
            { renderedType, fieldName } <- renderUnionField t
            line $ "public " <> renderedType <> " " <> fieldName <> ";"
        blank
        line $ "static class Deserializer extends JsonDeserializer<" <> unionName <> "> {"
        indent do
            line "@Override"
            line $ "public " <> unionName <> " deserialize(JsonParser jsonParser, DeserializationContext deserializationContext) throws IOException, JsonProcessingException {"
            indent do
                line $ unionName <> " value = new " <> unionName <> "();"
                line "switch (jsonParser.getCurrentToken()) {"
                when hasNull renderNullCase
                renderPrimitiveCase ["VALUE_NUMBER_INT"] IRInteger nonNullTypes
                renderDoubleCase nonNullTypes
                renderPrimitiveCase ["VALUE_TRUE", "VALUE_FALSE"] IRBool nonNullTypes
                renderPrimitiveCase ["VALUE_STRING"] IRString nonNullTypes
                renderGenericCase isArray "START_ARRAY" nonNullTypes
                renderGenericCase isClass "START_OBJECT" nonNullTypes
                renderGenericCase isMap "START_OBJECT" nonNullTypes
                line $ "default: throw new IOException(\"Cannot deserialize " <> unionName <> "\");"
                line "}"
                line "return value;"
            line "}"
        line "}"
        blank

        line $ "static class Serializer extends JsonSerializer<" <> unionName <> "> {"
        indent do
            line "@Override"
            line $ "public void serialize(" <> unionName <> " obj, JsonGenerator jsonGenerator, SerializerProvider serializerProvider) throws IOException {"
            indent do
                forUnion_ nonNullUnion \field -> do
                    { fieldName } <- renderUnionField field
                    line $ "if (obj." <> fieldName <> " != null) {"
                    indent do
                        line $ "jsonGenerator.writeObject(obj." <> fieldName <> ");"
                        line "return;"
                    line "}"
                if hasNull
                    then
                        line "jsonGenerator.writeNull();"
                    else
                        line $ "throw new IOException(\"" <> unionName <> " must not be null\");"
            line "}"
        line "}"
    line "}"