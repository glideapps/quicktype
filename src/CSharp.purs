module CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter)
import Data.Foldable (find, for_, intercalate)
import Data.List (List, (:))
import Data.List as L
import Data.Map as M
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Util (capitalize, camelCase, stringEscape)
import Data.Tuple (Tuple(..))
import Partial.Unsafe (unsafePartial)

import Utils (removeElement)

forbiddenNames :: Array String
forbiddenNames = ["Converter", "JsonConverter", "Type"]

renderer :: Renderer
renderer =
    { name: "C#"
    , aceMode: "csharp"
    , extension: "cs"
    , doc: csharpDoc
    , transforms:
        { nameForClass
        , unionName: Just unionName
        , unionPredicate: Just unionPredicate
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        , topLevelNameFromGiven: id
        , forbiddenFromTopLevelNameGiven: const []
        }
    }

unionPredicate :: IRType -> Maybe (Set IRType)
unionPredicate = case _ of
    IRUnion ur ->
        let s = unionToSet ur
        in case nullableFromSet s of
            Nothing -> Just s
            _ -> Nothing
    _ -> Nothing      

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = csNameStyle $ combineNames names

unionName :: List String -> String
unionName s =
    L.sort s
    <#> csNameStyle
    # intercalate "Or"

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isLetterCharacter :: Char -> Boolean
isLetterCharacter c =
    isLetter c || (generalCategory c == Just LetterNumber)

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    isLetterCharacter c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Nothing -> false
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
    Just Format -> true
    _ -> isLetterCharacter c

legalizeIdentifier :: String -> String
legalizeIdentifier str =
    case Str.charAt 0 str of
    -- FIXME: use the type to infer a name?
    Nothing -> "Empty"
    Just s ->
        if isStartCharacter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier ("_" <> str)

renderUnionToCSharp :: Set IRType -> Doc String
renderUnionToCSharp s =
    case nullableFromSet s of
    Just x -> do
        rendered <- renderTypeToCSharp x
        pure if isValueType x then rendered <> "?" else rendered
    Nothing -> lookupUnionName s

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
    IRUnion types -> renderUnionToCSharp $ unionToSet types

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

csharpDoc :: Doc Unit
csharpDoc = do
    line """// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do:
//
//    var data = QuickType.Converter.FromJson(jsonString);
//
namespace QuickType
{"""
         
    blank
    indent do
        line """using System;
using System.Net;
using System.Collections.Generic;

using Newtonsoft.Json;"""
        blank
        renderJsonConverter
        blank
        classes <- getClasses
        for_ classes \(Tuple i cd) -> do
            className <- lookupClassName i
            renderCSharpClass cd className
            blank
        unions <- getUnions
        for_ unions \types -> do
            renderCSharpUnion types
            blank
    line "}"

stringIfTrue :: Boolean -> String -> String
stringIfTrue true s = s
stringIfTrue false _ = ""

renderJsonConverter :: Doc Unit
renderJsonConverter = do
    unionNames <- getUnionNames
    let haveUnions = not $ M.isEmpty unionNames
    let names = M.values unionNames
    line $ "public class Converter" <> stringIfTrue haveUnions ": JsonConverter" <> " {"
    indent do
        line "static JsonSerializerSettings Settings = new JsonSerializerSettings"
        line "{"
        indent do
            line "MetadataPropertyHandling = MetadataPropertyHandling.Ignore,"
            line "DateParseHandling = DateParseHandling.None,"
            when haveUnions do
                line "Converters = { new Converter() },"
        line "};"
        blank
        toplevelType <- getTopLevel >>= renderTypeToCSharp
        line "// Loading helpers"
        line
            $ "public static "
            <> toplevelType
            <> " FromJson(string json) => JsonConvert.DeserializeObject<"
            <> toplevelType
            <> ">(json, Settings);"
        line
            $ "public static string ToJson("
            <> toplevelType
            <> " o) => JsonConvert.SerializeObject(o, Settings);"

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
    line "}"

tokenCase :: String -> Doc Unit
tokenCase tokenType =
    line $ "case JsonToken." <> tokenType <> ":"

renderNullDeserializer :: Set IRType -> Doc Unit
renderNullDeserializer types =
    when (S.member IRNull types) do
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

renderPrimitiveDeserializer :: List String -> IRType -> Set IRType -> Doc Unit
renderPrimitiveDeserializer tokenTypes t types =
    when (S.member t types) do
        for_ tokenTypes \tokenType -> do
            tokenCase tokenType
        indent do
            deserializeType t

renderDoubleDeserializer :: Set IRType -> Doc Unit
renderDoubleDeserializer types =
    when (S.member IRDouble types) do
        unless (S.member IRInteger types) do
            tokenCase "Integer"
        tokenCase "Float"
        indent do
            deserializeType IRDouble

renderGenericDeserializer :: (IRType -> Boolean) -> String -> Set IRType -> Doc Unit
renderGenericDeserializer predicate tokenType types = unsafePartial $
    case find predicate types of
    Nothing -> pure unit
    Just t -> do
        tokenCase tokenType
        indent do
            deserializeType t

renderCSharpUnion :: Set IRType -> Doc Unit
renderCSharpUnion allTypes = do
    name <- lookupUnionName allTypes
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) allTypes
    line $ "public struct " <> name
    line "{"
    indent do
        for_ nonNullTypes \t -> do
            typeString <- renderUnionToCSharp $ S.union (S.singleton t) (S.singleton IRNull)
            field <- unionFieldName t
            line $ "public " <> typeString <> " " <> field <> ";"
        blank
        line $ "public " <> name <> "(JsonReader reader, JsonSerializer serializer)"
        line "{"
        indent do
            for_ (L.fromFoldable nonNullTypes) \field -> do
                fieldName <- unionFieldName field
                line $ fieldName <> " = null;"
            blank
            line "switch (reader.TokenType)"
            line "{"
            indent do
                renderNullDeserializer allTypes
                renderPrimitiveDeserializer (L.singleton "Integer") IRInteger allTypes
                renderDoubleDeserializer allTypes
                renderPrimitiveDeserializer (L.singleton "Boolean") IRBool allTypes
                renderPrimitiveDeserializer ("String" : "Date" : L.Nil) IRString allTypes
                renderGenericDeserializer isArray "StartArray" allTypes
                renderGenericDeserializer isClass "StartObject" allTypes
                renderGenericDeserializer isMap "StartObject" allTypes
                line $ "default: throw new Exception(\"Cannot convert " <> name <> "\");"
            line "}"
        line "}"
        blank
        line $ "public void WriteJson(JsonWriter writer, JsonSerializer serializer)"
        line "{"
        indent do
            for_ (L.fromFoldable nonNullTypes) \field -> do
                fieldName <- unionFieldName field
                line $ "if (" <> fieldName <> " != null) {"
                indent do
                    line $ "serializer.Serialize(writer, " <> fieldName <> ");"
                    line "return;"
                line "}"
            when (isJust emptyOrNull) do
                line "writer.WriteNull();"
            when (isNothing emptyOrNull) do
                line "throw new Exception(\"Union must not be null\");"
        line "}"
    line "}"

renderCSharpClass :: IRClassData -> String -> Doc Unit
renderCSharpClass (IRClassData { names, properties }) className = do
    let propertyNames = transformNames csNameStyle ("Other" <> _) (S.singleton className) $ map (\n -> Tuple n n) $ M.keys properties
    line $ "public class " <> className
    line "{"
    indent do
        for_ (M.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            line $ "[JsonProperty(\"" <> stringEscape pname <> "\")]"
            rendered <- renderTypeToCSharp ptype
            let csPropName = lookupName pname propertyNames
            line $ "public " <> rendered <> " " <> csPropName <> " { get; set; }"
            blank
    line "}"
