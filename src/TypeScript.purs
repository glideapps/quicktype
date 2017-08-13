module TypeScript 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter)
import Data.Either as Either
import Data.Foldable (any, for_, intercalate, maximum)
import Data.List (List)
import Data.List as L
import Data.Map as M
import Data.Maybe (Maybe(Nothing, Just), maybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Regex as Rx
import Data.String.Regex.Flags as RxFlags
import Data.String.Util as Str
import Data.Tuple (Tuple(..), fst)
import Partial.Unsafe (unsafePartial)
import Utils (mapM)

renderer :: Renderer
renderer =
    { name: "TypeScript"
    , aceMode: "typescript"
    , extension: "ts"
    , doc: typeScriptDoc
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , unionName: Nothing
        , unionPredicate: Just unionPredicate
        , nextName: \s -> s <> "_"
        , forbiddenNames: ["Convert"] <> reservedWords
        , topLevelName: simpleNamer lowerNameStyle
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
nameForClass (IRClassData { names }) = upperNameStyle $ combineNames names

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isLetterCharacter :: Char -> Boolean
isLetterCharacter c = isLetter c || generalCategory c == Just LetterNumber

isStartCharacter :: Char -> Boolean
isStartCharacter c = isLetterCharacter c || c == '_'

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
    Nothing -> "Empty"
    Just s ->
        if isStartCharacter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier ("_" <> str)

renderUnion :: Set IRType -> Doc String
renderUnion s =
    case nullableFromSet s of
    Just x -> renderType x
    Nothing -> do
        types <- mapM renderType $ L.fromFoldable s
        pure $ intercalate " | " types

renderType :: IRType -> Doc String
renderType = case _ of
    IRNothing -> pure "any" -- we can have arrays of nothing
    IRNull -> pure "null"
    IRInteger -> pure "number"
    IRDouble -> pure "number"
    IRBool -> pure "boolean"
    IRString -> pure "string"
    IRArray a@(IRUnion _) -> do
        rendered <- renderType a
        pure $ "Array<" <> rendered <> ">"
    IRArray a -> do
        rendered <- renderType a
        pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType t
        pure $ "{ [key: string]: " <> rendered <> " }"
    IRUnion types -> renderUnion $ unionToSet types

getContainedClassName :: IRType -> Doc (Maybe String)
getContainedClassName = case _ of
    IRArray a -> getContainedClassName a
    IRClass i -> Just <$> lookupClassName i
    _ -> pure Nothing

upperNameStyle :: String -> String
upperNameStyle = Str.camelCase >>> Str.capitalize >>> legalizeIdentifier

lowerNameStyle :: String -> String
lowerNameStyle = Str.camelCase >>> Str.decapitalize >>> legalizeIdentifier

quote :: String -> String
quote s = "\"" <> s <> "\""

propertyNamify :: String -> String
propertyNamify s
    | Rx.test hasInternalSeparator s = quote $ Str.stringEscape s
    | Str.null s = quote ""
    | any (not <<< isStartCharacter) (Str.toCharArray s) = quote $ Str.stringEscape s
    | otherwise =  Str.stringEscape s

hasInternalSeparator :: Rx.Regex
hasInternalSeparator = unsafePartial $ Either.fromRight $ Rx.regex "[-. ]" RxFlags.noFlags

typeMethodName :: String -> String -> Doc String
typeMethodName nameForSingle topLevelName = do
    single <- getSingleTopLevel
    pure $ maybe (topLevelName <> Str.capitalize nameForSingle) (const nameForSingle) single

deserializerName :: String -> Doc String
deserializerName = typeMethodName "fromJson"

serializerName :: String -> Doc String
serializerName = typeMethodName "toJson"

typeScriptDoc :: Doc Unit
typeScriptDoc = do
    topLevelTypes <- M.values <$> getTopLevels
    topMaybeClassNames :: List (Maybe String) <- mapM getContainedClassName topLevelTypes
    let maybeTopClassNames = mapM id topMaybeClassNames
    moduleName <- getModuleName upperNameStyle
    let imports =
            case maybeTopClassNames of
                Just names -> {
                    basic:    "{ " <> intercalate ", " names  <> " }",
                    advanced: "{ " <> intercalate ", " names  <> ", Convert }"
                }
                Nothing -> {
                    basic:    "* as " <> moduleName,
                    advanced: "{ Convert }"
                }

    line $ """// To parse this data:
//
//   import """ <> imports.basic  <> """ from "./""" <> moduleName  <> ";"
    forTopLevel_ \topLevelName topLevelType -> do
        topFull <- renderType topLevelType
        line $ "//   let value: " <> topFull  <> " = JSON.parse(json);"
    line $ """//
// Or use Convert.fromJson to perform a type-checking conversion:
//
//   import """ <> imports.advanced  <> """ from "./""" <> moduleName  <> ";"
    forTopLevel_ \topLevelName topLevelType -> do
        topFull <- renderType topLevelType
        deserializer <- deserializerName topLevelName
        line $ "//   let value: " <> topFull  <> " = Convert." <> deserializer <> "(json);"
    line "//"
    blank
    classes <- getClasses
    for_ classes \(Tuple i cd) -> do
        interface <- lookupClassName i
        renderInterface cd interface
        blank

    line "//"
    line "// The Convert module parses JSON and asserts types"
    line "//"
    blank
    converter

renderInterface :: IRClassData -> String -> Doc Unit
renderInterface (IRClassData { names, properties }) className = do
    let { names: propertyNames } = transformNames (simpleNamer propertyNamify) (_ <> "_") (S.empty) $ map (\n -> Tuple n n) $ M.keys properties

    let resolver name typ = markNullable (lookupName name propertyNames) typ
    let resolvePropertyNameWithType (Tuple name typ) = Tuple (resolver name typ) typ         

    line $ "export interface " <> className <> " {"
    indent do
        let props = M.toUnfoldable properties :: Array _
        let resolved = resolvePropertyNameWithType <$> props
        let maxWidth = resolved <#> fst <#> Str.length # maximum
        for_ resolved \(Tuple pname ptype) -> do
            let indent = maybe 1 (\w -> w - Str.length pname + 1) maxWidth 
            rendered <- renderType ptype
            line $ pname <> ":" <> Str.times " " indent <> rendered <> ";"
    line "}"

-- If this is a nullable, add a '?'
markNullable :: String -> IRType -> String
markNullable name (IRUnion unionRep) =
    case nullableFromSet $ unionToSet unionRep of
        Just _ -> name <> "?"
        _ -> name
markNullable name _ = name

renderTypeMapType :: IRType -> Doc String
renderTypeMapType = case _ of
    IRNothing -> pure $ quote "undefined"
    IRNull -> pure $ quote "undefined"
    IRInteger -> pure $ quote "number"
    IRDouble -> pure $ quote "number"
    IRBool -> pure $ quote "boolean"
    IRString -> pure $ quote "string"
    IRArray a -> do
        rendered <- renderTypeMapType a
        pure $ "array(" <> rendered <> ")"
    IRClass i -> do
        name <- lookupClassName i
        pure $ "object(" <> quote name <> ")"
    IRMap t -> do
        rendered <- renderTypeMapType t
        pure $ "map(" <> rendered <> ")"
    IRUnion types -> do
        renderedTyps <- mapM renderTypeMapType $ L.fromFoldable $ unionToSet types
        pure $ "union(" <> intercalate ", " renderedTyps <> ")"

renderTypeMapClass :: IRClassData -> String -> Doc Unit
renderTypeMapClass (IRClassData { names, properties }) className = do
    line $ className <> ": {"
    indent do
        let props = M.toUnfoldable properties :: Array _
        for_ props \(Tuple pname ptype) -> do
            rendered <- renderTypeMapType ptype
            line $ propertyNamify pname <> ": " <> rendered <> ","
    line "},"

typemap :: Doc Unit
typemap = do
    line "// The typeMap is used to assert that objects from"
    line "// JSON.parse conform to the types we expect them to."
    line $ "const typeMap = {"
    indent do
        classes <- getClasses
        for_ classes \(Tuple i cd) -> do
            className <- lookupClassName i
            renderTypeMapClass cd className
    line $ "};"

converter :: Doc Unit
converter = do
    line $ """export module Convert {
    let path = [];
"""
    forTopLevel_ \topLevelName topLevelType -> do
        topFull <- renderType topLevelType
        topTypeMap <- renderTypeMapType topLevelType
        deserializer <- deserializerName topLevelName
        serializer <- serializerName topLevelName
        line $ """    export function """ <> deserializer <> """(json: string): """ <> topFull <> """ {
        return cast(JSON.parse(json), """ <> topTypeMap <> """);
    }

    export function toJson(value: """ <> topFull <> """): string {
        return JSON.stringify(value);
    }
"""
    line """    function cast<T>(obj: any, typ: any): T {
        path = [];
        if (!isValid(typ, obj)) {
            throw `Invalid value: obj${path.join("")}`;
        }
        return obj;
    }

    function isValid(typ: any, val: any): boolean {
        return typ.isUnion  ? isValidUnion(typ.typs, val)
             : typ.isArray  ? isValidArray(typ.typ, val)
             : typ.isMap    ? isValidMap(typ.typ, val)
             : typ.isObject ? isValidObject(typ.cls, val)
             :                isValidPrimitive(typ, val);
    }

    function isValidPrimitive(typ: string, val: any) {
        if (typ == "undefined") return !val;
        return typ === typeof val;
    }

    function isValidUnion(typs: any[], val: any): boolean {
        // val must validate against one typ in typs
        return typs.find(typ => isValid(typ, val)) !== undefined;
    }

    function isValidArray(typ: any, val: any): boolean {
        // val must be an array with no invalid elements
        return Array.isArray(val) && !val.find((val, i) => {
            path.push(`[${i}]`);
            if (isValid(typ, val)) {
                path.pop();
            } else {
                return true;
            }
        });
    }

    function isValidMap(typ: any, val: any): boolean {
        // all values in the map must be typ
        for (let prop in val) {
            path.push(`["${prop}"]`);
            if (!isValid(typ, val[prop]))
                return false;
            path.pop();
        }
        return true;
    }

    function isValidObject(className: string, val: any): boolean {
        let typeRep = typeMap[className];
        
        for (let prop in typeRep) {
            path.push(`.${prop}`);
            if (!isValid(typeRep[prop], val[prop]))
                return false;
            path.pop();
        }

        return true;
    }

    function array(typ: any) {
        return { typ, isArray: true };
    }

    function union(...typs: any[]) {
        return { typs, isUnion: true };
    }

    function map(typ: any) {
        return { typ, isMap: true };
    }

    function object(className: string) {
        return { cls: className, isObject: true };
    }
"""
    indent typemap
    line """
}
"""

reservedWords :: Array String
reservedWords = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "as", "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "any", "boolean", "constructor", "declare", "get", "module", "require", "number", "set", "string", "symbol", "type", "from", "of"]
