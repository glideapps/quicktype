module Language.CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory)
import Data.Foldable (find, for_, intercalate)
import Data.List (List, (:))
import Data.List as L
import Data.Map as M
import Data.Map (Map)
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Set (Set)
import Data.Set as S
import Data.String.Util (camelCase, legalizeCharacters, startWithLetter, stringEscape, isLetterOrLetterNumber)
import Utils (removeElement)

forbiddenNames :: Array String
forbiddenNames = ["Convert", "JsonConverter", "Type"]

renderer :: Renderer
renderer =
    { name: "C#"
    , aceMode: "csharp"
    , extension: "cs"
    , doc: csharpDoc
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        , topLevelName: noForbidNamer csNameStyle
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (csNameStyle <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated csNameStyle "Or")
            }
        }
    }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = csNameStyle $ combineNames names

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    isLetterOrLetterNumber c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
    Just Format -> true
    _ -> isStartCharacter c

renderNullableToCSharp :: IRType -> Doc String
renderNullableToCSharp x = do
    rendered <- renderTypeToCSharp x
    pure if isValueType x then rendered <> "?" else rendered

renderUnionToCSharp :: IRUnionRep -> Doc String
renderUnionToCSharp ur =
    case nullableFromUnion ur of
    Just x -> renderNullableToCSharp x
    Nothing -> lookupUnionName ur

renderTypeToCSharp :: IRType -> Doc String
renderTypeToCSharp = case _ of
    IRNothing -> pure "object" -- we can have arrays of nothing
    IRNull -> pure "object"
    IRInteger -> pure "long"
    IRDouble -> pure "double"
    IRBool -> pure "bool"
    IRString -> pure "string"
    IRArray a -> do
        rendered <- renderTypeToCSharp a
        pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderTypeToCSharp t
        pure $ "Dictionary<string, " <> rendered <> ">"
    IRUnion ur -> renderUnionToCSharp ur

legalize :: String -> String
legalize = legalizeCharacters isPartCharacter

csNameStyle :: String -> String
csNameStyle = legalize >>> camelCase >>> startWithLetter isStartCharacter true

getDecoderHelperPrefix :: String -> Doc String
getDecoderHelperPrefix topLevelName = getForSingleOrMultipleTopLevels "" topLevelName

csharpDoc :: Doc Unit
csharpDoc = do
    module_ <- getModuleName csNameStyle
    oneOfThese <- getForSingleOrMultipleTopLevels "" " one of these"
    line $ "// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do" <> oneOfThese <> ":"
    forEachTopLevel_ \topLevelName topLevelType -> do
        prefix <- getDecoderHelperPrefix topLevelName
        line "//"
        line $ "//    var data = " <> module_ <> ".Convert." <> prefix <> "FromJson(jsonString);"
    line "//"
    line $ "namespace " <> module_
    line "{"
    indent do
        line """using System;
using System.Net;
using System.Collections.Generic;

using Newtonsoft.Json;
"""
        renderRenderItems blank Nothing renderCSharpClass (Just renderCSharpUnion)
        blank
        renderJsonConverter
    line "}"

stringIfTrue :: Boolean -> String -> String
stringIfTrue true s = s
stringIfTrue false _ = ""

renderJsonConverter :: Doc Unit
renderJsonConverter = do
    unionNames <- getUnionNames
    let haveUnions = not $ M.isEmpty unionNames
    let names = M.values unionNames
    line $ "public class Convert" <> stringIfTrue haveUnions " : JsonConverter"
    line "{"
    indent do
        line "// Serialize/deserialize helpers"
        forEachTopLevel_ \topLevelName topLevelType -> do
            blank
            topLevelTypeRendered <- renderTypeToCSharp topLevelType
            fromJsonPrefix <- getDecoderHelperPrefix topLevelName
            line
                $ "public static "
                <> topLevelTypeRendered 
                <> " "
                <> fromJsonPrefix
                <> "FromJson(string json) => JsonConvert.DeserializeObject<"
                <> topLevelTypeRendered
                <> ">(json, Settings);"
            line
                $ "public static string ToJson("
                <> topLevelTypeRendered
                <> " o) => JsonConvert.SerializeObject(o, Settings);"

        blank
        line "// JsonConverter stuff"

        when haveUnions do
            blank
            line "public override bool CanConvert(Type t)"
            line "{"
            indent $ line $ "return " <> intercalate " || " (map (\n -> "t == typeof(" <> n <> ")") names) <> ";"
            line "}"
            blank
            line "public override object ReadJson(JsonReader reader, Type t, object existingValue, JsonSerializer serializer)"
            line "{"
            indent do
                -- FIXME: call the constructor via reflection?
                for_ names \name -> do
                    line $ "if (t == typeof(" <> name <> "))"
                    indent $ line $ "return new " <> name <> "(reader, serializer);"
                line "throw new Exception(\"Unknown type\");"
            line "}"
            blank
            line "public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)"
            line "{"
            indent do
                line "var t = value.GetType();"
                for_ names \name -> do
                    line $ "if (t == typeof(" <> name <> ")) {"
                    indent do
                        line $ "((" <> name <> ")value).WriteJson(writer, serializer);"
                        line "return;"
                    line "}"
                line "throw new Exception(\"Unknown type\");"
            line "}"

        blank
        line "static JsonSerializerSettings Settings = new JsonSerializerSettings"
        line "{"
        indent do
            line "MetadataPropertyHandling = MetadataPropertyHandling.Ignore,"
            line "DateParseHandling = DateParseHandling.None,"
            when haveUnions do
                line "Converters = { new Convert() },"
        line "};"
    line "}"

tokenCase :: String -> Doc Unit
tokenCase tokenType =
    line $ "case JsonToken." <> tokenType <> ":"

renderNullDeserializer :: Doc Unit
renderNullDeserializer = do
    tokenCase "Null"
    indent do
        line "break;"

unionFieldName :: IRType -> Doc String
unionFieldName t = csNameStyle <$> getTypeNameForUnion t

deserialize :: String -> String -> Doc Unit
deserialize fieldName typeName = do
    line $ fieldName <> " = serializer.Deserialize<" <> typeName <> ">(reader);"
    line "break;"

deserializeType :: IRType -> Doc Unit
deserializeType t = do
    fieldName <- unionFieldName t
    renderedType <- renderTypeToCSharp t
    deserialize fieldName renderedType

renderPrimitiveDeserializer :: List String -> IRType -> IRUnionRep -> Doc Unit
renderPrimitiveDeserializer tokenTypes t union =
    when (isUnionMember t union) do
        for_ tokenTypes \tokenType -> do
            tokenCase tokenType
        indent do
            deserializeType t

renderDoubleDeserializer :: IRUnionRep -> Doc Unit
renderDoubleDeserializer union =
    when (isUnionMember IRDouble union) do
        unless (isUnionMember IRInteger union) do
            tokenCase "Integer"
        tokenCase "Float"
        indent do
            deserializeType IRDouble

renderGenericDeserializer :: (IRType -> Boolean) -> String -> Set IRType -> Doc Unit
renderGenericDeserializer predicate tokenType types =
    case find predicate types of
    Nothing -> pure unit
    Just t -> do
        tokenCase tokenType
        indent do
            deserializeType t

renderCSharpUnion :: String -> IRUnionRep -> Doc Unit
renderCSharpUnion name unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    let nonNullTypes = unionToSet nonNullUnion
    line $ "public struct " <> name
    line "{"
    indent do
        forUnion_ nonNullUnion \t -> do
            typeString <- renderNullableToCSharp t
            field <- unionFieldName t
            line $ "public " <> typeString <> " " <> field <> ";"
        blank
        line $ "public " <> name <> "(JsonReader reader, JsonSerializer serializer)"
        line "{"
        indent do
            forUnion_ nonNullUnion \field -> do
                fieldName <- unionFieldName field
                line $ fieldName <> " = null;"
            blank
            line "switch (reader.TokenType)"
            line "{"
            indent do
                when hasNull renderNullDeserializer
                renderPrimitiveDeserializer (L.singleton "Integer") IRInteger nonNullUnion
                renderDoubleDeserializer nonNullUnion
                renderPrimitiveDeserializer (L.singleton "Boolean") IRBool nonNullUnion
                renderPrimitiveDeserializer ("String" : "Date" : L.Nil) IRString nonNullUnion
                renderGenericDeserializer isArray "StartArray" nonNullTypes
                renderGenericDeserializer isClass "StartObject" nonNullTypes
                renderGenericDeserializer isMap "StartObject" nonNullTypes
                line $ "default: throw new Exception(\"Cannot convert " <> name <> "\");"
            line "}"
        line "}"
        blank
        line $ "public void WriteJson(JsonWriter writer, JsonSerializer serializer)"
        line "{"
        indent do
            forUnion_ nonNullUnion \field -> do
                fieldName <- unionFieldName field
                line $ "if (" <> fieldName <> " != null) {"
                indent do
                    line $ "serializer.Serialize(writer, " <> fieldName <> ");"
                    line "return;"
                line "}"
            if hasNull
                then
                    line "writer.WriteNull();"
                else
                    line "throw new Exception(\"Union must not be null\");"
        line "}"
    line "}"

renderCSharpClass :: String -> Map String IRType -> Doc Unit
renderCSharpClass className properties = do
    let propertyNames = transformPropertyNames (simpleNamer csNameStyle) ("Other" <> _) [className] properties
    line $ "public class " <> className
    line "{"
    indent do
        forEachProperty_ properties propertyNames \pname ptype csPropName isLast -> do
            line $ "[JsonProperty(\"" <> stringEscape pname <> "\")]"
            rendered <- renderTypeToCSharp ptype
            line $ "public " <> rendered <> " " <> csPropName <> " { get; set; }"
            unless isLast blank
    line "}"
