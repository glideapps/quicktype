module CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types

import Data.Array (concatMap)
import Data.Char (toCharCode)
import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter, isPrint)
import Data.Foldable (for_, intercalate)
import Data.List (List, fromFoldable, sort, (:))
import Data.List as L
import Data.Map (Map, lookup)
import Data.Map as M
import Data.Maybe (Maybe(..), fromJust, fromMaybe, isNothing)
import Data.Set (Set, insert, singleton, union)
import Data.Set as S
import Data.String (fromCharArray, toCharArray)
import Data.String as Str
import Data.String.Util (capitalize, camelCase, intToHex)
import Data.String.Utils (mapChars)
import Data.Tuple (Tuple(..))

renderer :: Renderer
renderer =
    { name: "C#"
    , aceMode: "csharp"
    , extension: "cs"
    , doc: csharpDoc
    }

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

stringify :: String -> String
stringify str =
    "\"" <> (Str.fromCharArray $ concatMap charRep $ Str.toCharArray str) <> "\""
    where
        charRep c =
            case c of
            '\\' -> ['\\', '\\']
            '\"' -> ['\\', '\"']
            '\n' -> ['\\', 'n']
            '\t' -> ['\\', 't']
            _ ->
                if isPrint c then
                    [c]
                else
                    let i = toCharCode c
                    in
                        if i <= 0xffff then
                            Str.toCharArray $ "\\u" <> intToHex 4 i
                        else
                            Str.toCharArray $ "\\U" <> intToHex 8 i

nullableFromSet :: Set IRType -> Maybe IRType
nullableFromSet s =
    case L.fromFoldable s of
    IRNull : x : L.Nil -> Just x
    x : IRNull : L.Nil -> Just x
    _ -> Nothing

renderUnionToCSharp :: Map Int String -> Map (Set IRType) String -> IRGraph -> Set IRType -> String
renderUnionToCSharp classNames unionNames graph s =
    case nullableFromSet s of
    Just x ->
        let rendered = renderTypeToCSharp classNames unionNames graph x
        in
            if isValueType x then rendered <> "?" else rendered
    Nothing -> lookupName s unionNames

lookupName :: forall a. Ord a => a -> Map a String -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ M.lookup original nameMap

renderTypeToCSharp :: Map Int String -> Map (Set IRType) String -> IRGraph -> IRType -> String
renderTypeToCSharp classNames unionNames graph = case _ of
    IRNothing -> "object"
    IRNull -> "object"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> renderTypeToCSharp classNames unionNames graph a <> "[]"
    IRClass i -> lookupName i classNames
    IRMap t -> "Dictionary<string, " <> renderTypeToCSharp classNames unionNames graph t <> ">"
    IRUnion types -> renderUnionToCSharp classNames unionNames graph types

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

typeNameForUnion :: Map Int String -> IRGraph -> IRType -> String
typeNameForUnion classNames graph = case _ of
    IRNothing -> "nothing"
    IRNull -> "null"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> typeNameForUnion classNames graph a <> "_array"
    IRClass i ->
        let IRClassData { names } = getClassFromGraph graph i
        in
            combineNames names
    IRMap t -> typeNameForUnion classNames graph t <> "_map"
    IRUnion _ -> "union"

unionName :: Map Int String -> IRGraph -> Set IRType -> String
unionName classNames graph s =
    "OneOf" <> (csNameStyle $ intercalate "_" $ map (typeNameForUnion classNames graph) $ L.sort $ L.fromFoldable s)

csharpDoc :: Doc Unit
csharpDoc = do
    lines """namespace QuickType
             {"""
    blank
    indent do
        lines """using System.Net;
                 using System.Collections.Generic;
                 using Newtonsoft.Json;"""
        blank
        classes <- getClasses
        let classNames = transformNames (\(IRClassData { names }) -> csNameStyle $ combineNames names) ("Other" <> _) S.empty classes
        graph <- getGraph
        let unions = filterTypes unionPredicate graph
        let unionNames = transformNames (unionName classNames graph) ("Other" <> _) (S.fromFoldable $ M.values classNames) $ map (\s -> Tuple s s) unions
        for_ classes \(Tuple i cls) -> do
            renderCSharpClass classNames unionNames i cls
            blank
        for_ unions \types -> do
            renderCSharpUnion classNames unionNames types
            blank
    lines "}"
    where
        unionPredicate =
            case _ of
            IRUnion s ->
                if isNothing $ nullableFromSet s then
                    Just s
                else
                    Nothing
            _ -> Nothing

renderCSharpUnion :: Map Int String -> Map (Set IRType) String -> Set IRType -> Doc Unit
renderCSharpUnion classNames unionNames types = do
    let name = lookupName types unionNames
    let { element: emptyOrNull, rest: types } = removeElement (_ == IRNull) types
    line $ words ["struct", name, "{"]
    indent do
        for_ types \t -> do
            line do
                graph <- getGraph
                let typeString = renderTypeToCSharp classNames unionNames graph $ IRUnion $ S.union (S.singleton t) (S.singleton IRNull)
                let fieldName = csNameStyle $ typeNameForUnion classNames graph t
                words ["public", typeString, fieldName <> ";"]
    lines "}"

renderCSharpClass :: Map Int String -> Map (Set IRType) String -> Int -> IRClassData -> Doc Unit
renderCSharpClass classNames unionNames classIndex (IRClassData { names, properties }) = do
    let className = lookupName classIndex classNames
    let propertyNames = transformNames csNameStyle ("Other" <> _) (S.singleton className) $ map (\n -> Tuple n n) $ M.keys properties
    line $ words ["class", className]

    lines "{"
    indent do
        for_ (M.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            line do
                string "[JsonProperty("
                string $ stringify pname
                string ")]"
            line do
                string "public "
                graph <- getGraph
                string $ renderTypeToCSharp classNames unionNames graph ptype
                let csPropName = lookupName pname propertyNames
                words ["", csPropName, "{ get; set; }"]
            blank
        
        -- TODO don't rely on 'TopLevel'
        when (names == S.singleton "TopLevel") do
            lines """// Loading helpers
                     public static TopLevel FromJson(string json) => JsonConvert.DeserializeObject<TopLevel>(json);"""
    lines "}"
