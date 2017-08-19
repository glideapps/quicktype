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
import Data.String.Util (camelCase, decapitalize, isLetterOrLetterNumber, legalizeCharacters, startWithLetter, stringEscape)
import Data.Tuple (Tuple(..))
import Utils (removeElement)

forbiddenNames :: Array String
forbiddenNames =
    [ "Object", "Class", "System", "Long", "Double", "Boolean", "String", "Map", "Exception", "IOException"
    , "JsonProperty", "JsonDeserialize", "JsonDeserializer", "JsonSerialize", "JsonSerializer"
    , "JsonParser", "JsonProcessingException", "DeserializationContext", "SerializerProvider"
    , "Converter"
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
        , topLevelName: noForbidNamer javaNameStyle
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (javaNameStyle <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated javaNameStyle "Or")
            }
        }
    }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = javaNameStyle $ combineNames names

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

javaNameStyle :: String -> String
javaNameStyle = legalizeCharacters isPartCharacter >>> camelCase >>> startWithLetter isStartCharacter true

javaDoc :: Doc Unit
javaDoc = do
    renderConverter
    forEachClass_ \className properties -> do
        blank
        renderClassDefinition className properties
    forEachUnion_ \unionName unionTypes -> do
        blank
        renderUnionDefinition unionName unionTypes

renderUnionWithTypeRenderer :: (Boolean -> IRType -> Doc String) -> IRUnionRep -> Doc String
renderUnionWithTypeRenderer typeRenderer ur =
    case nullableFromSet $ unionToSet ur of
    Just x -> typeRenderer true x
    Nothing -> lookupUnionName ur

renderUnion :: IRUnionRep -> Doc String
renderUnion = renderUnionWithTypeRenderer renderType

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

fieldNameForJavaName :: String -> String
fieldNameForJavaName = decapitalize >>> ("_" <> _)

forEachProperty_ :: Map String IRType -> Map String String -> (String -> IRType -> String -> String -> String -> Doc Unit) -> Doc Unit
forEachProperty_ properties propertyNames f =
    for_ (M.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
        let javaName = lookupName pname propertyNames
        let fieldName = fieldNameForJavaName javaName
        rendered <- renderType false ptype
        f pname ptype javaName fieldName rendered

renderFileHeader :: String -> Array String -> Doc Unit
renderFileHeader fileName imports = do
    line $ "// " <> fileName <> ".java"
    blank
    line "package io.quicktype;"
    blank
    for_ imports \package -> do
        line $ "import " <> package <> ";"
    blank

getDecoderHelperPrefix :: String -> Doc String
getDecoderHelperPrefix topLevelName = getForSingleOrMultipleTopLevels "" topLevelName

renderConverter :: Doc Unit
renderConverter = do
    renderFileHeader "Converter" ["java.util.Map", "java.io.IOException", "com.fasterxml.jackson.databind.ObjectMapper", "com.fasterxml.jackson.core.JsonProcessingException"]
    line "public class Converter {"
    indent do
        line "// Serialize/deserialize helpers"
        forEachTopLevel_ \topLevelName topLevelType -> do
            blank
            topLevelTypeRendered <- renderType false topLevelType
            fromJsonPrefix <- getDecoderHelperPrefix topLevelName
            line $ "public static " <> topLevelTypeRendered <> " " <> fromJsonPrefix <> "FromJsonString(String json) throws IOException {"
            indent do
                line "ObjectMapper mapper = new ObjectMapper();"
                renderedForClass <- renderTypeWithoutGenerics false topLevelType
                line $ "return mapper.readValue(json, " <> renderedForClass <> ".class);"
            line "}"
            blank
            line $ "public static String " <> fromJsonPrefix <> "ToJsonString(" <> topLevelTypeRendered <> " obj) throws JsonProcessingException {"
            indent do
                line "ObjectMapper mapper = new ObjectMapper();"
                line "return mapper.writeValueAsString(obj);"
            line "}"
    line "}"

renderClassDefinition :: String -> Map String IRType -> Doc Unit
renderClassDefinition className properties = do
    renderFileHeader className ["java.util.Map", "com.fasterxml.jackson.annotation.*"]
    let propertyNames = transformPropertyNames (simpleNamer javaNameStyle) ("Other" <> _) ["Class"] properties
    when (M.isEmpty properties) do
        line "@JsonAutoDetect(fieldVisibility=JsonAutoDetect.Visibility.NONE)"
    line $ "public class " <> className <> " {"
    indent do
        forEachProperty_ properties propertyNames \pname ptype javaName fieldName rendered -> do
            line $ "private " <> rendered <> " " <> fieldName <> ";"
        forEachProperty_ properties propertyNames \pname ptype javaName fieldName rendered -> do
            blank
            line $ "@JsonProperty(\"" <> stringEscape pname <> "\")"
            line $ "public " <> rendered <> " get" <> javaName <> "() { return " <> fieldName <> "; }"
            line $ "public void set" <> javaName <> "(" <> rendered <> " value) { " <> fieldName <> " = value; }"
    line "}"

renderUnionField :: IRType -> Doc { renderedType :: String, fieldName :: String }
renderUnionField t = do
    renderedType <- renderType true t
    fieldName <- decapitalize <$> javaNameStyle <$> (_ <> "_value") <$> getTypeNameForUnion t
    pure { renderedType, fieldName }

tokenCase :: String -> Doc Unit
tokenCase tokenType =
    line $ "case " <> tokenType <> ":"

renderNullCase :: Set IRType -> Doc Unit
renderNullCase types =
    when (S.member IRNull types) do
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

renderUnionDefinition :: String -> Set IRType -> Doc Unit
renderUnionDefinition unionName unionTypes = do
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) unionTypes
    renderFileHeader unionName ["java.io.IOException", "java.util.Map", "com.fasterxml.jackson.core.*", "com.fasterxml.jackson.databind.*", "com.fasterxml.jackson.databind.annotation.*"]
    line $ "@JsonDeserialize(using = " <> unionName <> ".Deserializer.class)"
    line $ "@JsonSerialize(using = " <> unionName <> ".Serializer.class)"
    line $ "public class " <> unionName <> " {"
    indent do
        for_ nonNullTypes \t -> do
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
                renderNullCase unionTypes
                renderPrimitiveCase ["VALUE_NUMBER_INT"] IRInteger unionTypes
                renderDoubleCase unionTypes
                renderPrimitiveCase ["VALUE_TRUE", "VALUE_FALSE"] IRBool unionTypes
                renderPrimitiveCase ["VALUE_STRING"] IRString unionTypes
                renderGenericCase isArray "START_ARRAY" unionTypes
                renderGenericCase isClass "START_OBJECT" unionTypes
                renderGenericCase isMap "START_OBJECT" unionTypes
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
                for_ (A.fromFoldable nonNullTypes) \field -> do
                    { fieldName } <- renderUnionField field
                    line $ "if (obj." <> fieldName <> " != null) {"
                    indent do
                        line $ "jsonGenerator.writeObject(obj." <> fieldName <> ");"
                        line "return;"
                    line "}"
                when (isJust emptyOrNull) do
                    line "jsonGenerator.writeNull();"
                when (isNothing emptyOrNull) do
                    line $ "throw new IOException(\"" <> unionName <> " must not be null\");"
            line "}"
        line "}"
    line "}"