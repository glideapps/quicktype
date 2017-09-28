module Language.CSharp 
    ( renderer
    ) where

import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory)
import Data.Foldable (for_, intercalate, maximum)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set (Set)
import Data.String as String
import Data.String.Util as Str
import Data.Tuple (Tuple(Tuple), fst)
import Doc (Doc, Renderer, blank, combineNames, forEachProperty_, forEachTopLevel_, getForSingleOrMultipleTopLevels, getTypeNameForUnion, getUnionNames, indent, line, lookupClassName, lookupUnionName, noForbidNamer, renderRenderItems, simpleNamer, transformPropertyNames, unionIsNotSimpleNullable, unionNameIntercalated, getOptionValue)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, Named, forUnion_, isUnionMember, nullableFromUnion, removeNullFromUnion, unionHasArray, unionHasClass, unionHasMap)
import Options (Option, booleanOption, enumOption, stringOption)

forbiddenNames :: Array String
forbiddenNames =
    [ "QuickType"
    , "Converter"
    , "JsonConverter"
    , "Type"
    , "Serialize"
    -- We really only need this in dense mode
    , denseJsonPropertyName
    ]

listOption :: Option Boolean
listOption = enumOption "array-type" "Use T[] or List<T>" [Tuple "array" false, Tuple "list" true]

denseOption :: Option Boolean
denseOption = enumOption "density" "Property density" [Tuple "normal" false, Tuple "dense" true]

pocoOption :: Option Boolean
pocoOption = booleanOption "just-types" "Plain C# objects only" false

namespaceOption :: Option String
namespaceOption = stringOption "namespace" "The namespace for the classes" "NAME" "QuickType"

renderer :: Renderer
renderer =
    { displayName: "C#"
    , names: [ "csharp", "cs" ]
    , aceMode: "csharp"
    , extension: "cs"
    , doc: csharpDoc
    , options:
        [ denseOption.specification
        , listOption.specification
        , pocoOption.specification
        , namespaceOption.specification
        ]
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames
        , topLevelName: noForbidNamer csNameStyle
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer nameForType
            , nameFromTypes: simpleNamer (unionNameIntercalated csNameStyle "Or")
            }
        }
    }

denseJsonPropertyName :: String
denseJsonPropertyName = "J"

nameForType :: Named (Set String) -> String
nameForType = csNameStyle <<< combineNames

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = nameForType names

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    Str.isLetterOrLetterNumber c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
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
    IRNoInformation -> pure "FIXME"
    IRAnyType -> pure "object" -- we can have arrays of nothing
    IRNull -> pure "object"
    IRInteger -> pure "long"
    IRDouble -> pure "double"
    IRBool -> pure "bool"
    IRString -> pure "string"
    IRArray a -> do
        rendered <- renderTypeToCSharp a
        useList <- getOptionValue listOption
        if useList
            then
                pure $ "List<" <> rendered <> ">"
            else
                pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderTypeToCSharp t
        pure $ "Dictionary<string, " <> rendered <> ">"
    IRUnion ur -> renderUnionToCSharp ur

legalize :: String -> String
legalize = Str.legalizeCharacters isPartCharacter

csNameStyle :: String -> String
csNameStyle = legalize >>> Str.camelCase >>> Str.startWithLetter isStartCharacter true

csharpDoc :: Doc Unit
csharpDoc = do
    namespace <- getOptionValue namespaceOption
    whenSerializers do
        oneOfThese <- getForSingleOrMultipleTopLevels "" " one of these"
        line $ "// To parse this JSON data, add NuGet 'Newtonsoft.Json' then do" <> oneOfThese <> ":"
        line "//"
        line $ "//    using " <> namespace <> ";"
        forEachTopLevel_ \topLevelName topLevelType -> do
            line "//"
            line $ "//    var data = " <> topLevelName <> ".FromJson(jsonString);"
        line "//"
    
    line $ "namespace " <> namespace
    line "{"
    indent do
        let using s = line $ "using " <> s <> ";"
        using "System"
        using "System.Net"
        using "System.Collections.Generic"
        whenSerializers do
            blank
            using "Newtonsoft.Json"
            whenDense $ using $ denseJsonPropertyName <> " = Newtonsoft.Json.JsonPropertyAttribute"
        blank
        renderRenderItems blank Nothing renderCSharpClass (Just renderCSharpUnion)
        whenSerializers do
            renderCSharpClassJSONPartials
            renderRenderItems (pure unit) Nothing (\_ _ -> pure unit) (Just renderCSharpUnionReadWritePartial)
            renderJsonConverter
    line "}"

whenSerializers :: Doc Unit -> Doc Unit
whenSerializers doc = do
    poco <- getOptionValue pocoOption
    unless poco doc

whenDense :: Doc Unit -> Doc Unit
whenDense doc = do
    dense <- getOptionValue denseOption
    when dense doc

stringIfTrue :: Boolean -> String -> String
stringIfTrue true s = s
stringIfTrue false _ = ""

renderCSharpClassJSONPartials :: Doc Unit
renderCSharpClassJSONPartials = do
    forEachTopLevel_ \topLevelName topLevelType -> do
        blank
        topLevelTypeRendered <- renderTypeToCSharp topLevelType
        line $ "public partial class " <> topLevelName
        line "{"
        indent do
            line
                $ "public static "
                <> topLevelTypeRendered 
                <> " "
                <> "FromJson(string json)"
            line "{"
            indent do
                 line
                    $ "return JsonConvert.DeserializeObject<"
                    <> topLevelTypeRendered
                    <> ">(json, Converter.Settings);"
            line "}"
        line "}"

    whenSerializers do
        blank
        line $ "public static class Serialize"
        line "{"
        indent do
            forEachTopLevel_ \topLevelName topLevelType -> do
                topLevelTypeRendered <- renderTypeToCSharp topLevelType
                line $
                    "public static string ToJson(this "
                    <> topLevelTypeRendered
                    <> " self)"
                line "{"
                indent do
                    line "return JsonConvert.SerializeObject(self, Converter.Settings);"
                line "}"
    line "}"

renderJsonConverter :: Doc Unit
renderJsonConverter = do
    blank
    unionNames <- getUnionNames
    let haveUnions = not $ M.isEmpty unionNames
    let names = M.values unionNames
    line $ "public class Converter" <> stringIfTrue haveUnions ": JsonConverter"
    line "{"
    indent do
        when haveUnions do
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

            whenSerializers do
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

        line "public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings"
        line "{"
        indent do
            line "MetadataPropertyHandling = MetadataPropertyHandling.Ignore,"
            line "DateParseHandling = DateParseHandling.None,"
            when haveUnions do
                line "Converters = { new Converter() },"
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

renderGenericDeserializer :: (IRUnionRep -> Maybe IRType) -> String -> IRUnionRep -> Doc Unit
renderGenericDeserializer predicate tokenType union =
    case predicate union of
    Nothing -> pure unit
    Just t -> do
        tokenCase tokenType
        indent do
            deserializeType t

renderCSharpUnion :: String -> IRUnionRep -> Doc Unit
renderCSharpUnion name unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    poco <- getOptionValue pocoOption
    line $ "public" <> (if poco then "" else " partial") <> " struct " <> name
    line "{"
    indent do
        forUnion_ nonNullUnion \t -> do
            typeString <- renderNullableToCSharp t
            field <- unionFieldName t
            line $ "public " <> typeString <> " " <> field <> ";"
    line "}"

renderCSharpUnionReadWritePartial :: String -> IRUnionRep -> Doc Unit
renderCSharpUnionReadWritePartial name unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep

    blank
    line $ "public partial struct " <> name
    line "{"
    indent do
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
                renderGenericDeserializer unionHasArray "StartArray" nonNullUnion
                renderGenericDeserializer unionHasClass "StartObject" nonNullUnion
                renderGenericDeserializer unionHasMap "StartObject" nonNullUnion
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

    let props = M.toUnfoldable propertyNames :: Array _
    let maxWidth = props <#> fst <#> Str.stringEscape <#> String.length # maximum # fromMaybe 0

    poco <- getOptionValue pocoOption
    dense <- getOptionValue denseOption

    line $ "public" <> (if poco then "" else " partial") <> " class " <> className
    line "{"
    indent do
        forEachProperty_ properties propertyNames \pname ptype csPropName isLast -> do
            rendered <- renderTypeToCSharp ptype

            let jsonProperty = if dense then denseJsonPropertyName else "JsonProperty"
            let attribute = "[" <> jsonProperty <> "(\"" <> Str.stringEscape pname <> "\")]"
                
            let property = "public " <> rendered <> " " <> csPropName <> " { get; set; }"

            case poco, dense of
                true, _ -> line property
                _, true -> do
                    let indent = maxWidth - String.length (Str.stringEscape pname) + 1
                    let whitespace = Str.times " " indent
                    line $ attribute <> whitespace <> property
                _, false -> do 
                    line attribute
                    line property
            
            unless (poco || dense || isLast) blank

    line "}"
